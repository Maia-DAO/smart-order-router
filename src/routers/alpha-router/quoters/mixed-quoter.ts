import { Protocol } from 'hermes-swap-router-sdk';
import { TradeType } from 'hermes-v2-sdk';
import _ from 'lodash';
import { ChainId, Currency, NativeToken } from 'maia-core-sdk';

import {
  IOnChainQuoteProvider,
  IStablePoolProvider,
  IStableSubgraphProvider,
  ITokenListProvider,
  ITokenProvider,
  ITokenValidatorProvider,
  IV3PoolProvider,
  IV3SubgraphProvider,
  TokenValidationResult,
} from '../../../providers';
import {
  CurrencyAmount,
  log,
  metric,
  MetricLoggerUnit,
  routeToString,
} from '../../../util';
import { MixedRoute } from '../../router';
import { AlphaRouterConfig } from '../alpha-router';
import { MixedRouteWithValidQuote } from '../entities';
import { computeAllMixedRoutes } from '../functions/compute-all-routes';
import {
  CandidatePoolsBySelectionCriteria,
  getMixedRouteCandidatePools,
  StableCandidatePools,
  V3CandidatePools,
} from '../functions/get-candidate-pools';
import { IGasModel } from '../gas-models';

import { BaseQuoter } from './base-quoter';
import { GetQuotesResult, GetRoutesResult } from './model';

export class MixedQuoter extends BaseQuoter<
  // TODO: Add support for multiple pools
  [V3CandidatePools, StableCandidatePools],
  MixedRoute
> {
  protected stableSubgraphProvider: IStableSubgraphProvider;
  protected stablePoolProvider: IStablePoolProvider;
  protected v3SubgraphProvider: IV3SubgraphProvider;
  protected v3PoolProvider: IV3PoolProvider;
  protected onChainQuoteProvider: IOnChainQuoteProvider;

  constructor(
    stableSubgraphProvider: IStableSubgraphProvider,
    stablePoolProvider: IStablePoolProvider,
    v3SubgraphProvider: IV3SubgraphProvider,
    v3PoolProvider: IV3PoolProvider,
    onChainQuoteProvider: IOnChainQuoteProvider,
    tokenProvider: ITokenProvider,
    chainId: ChainId,
    blockedTokenListProvider?: ITokenListProvider,
    tokenValidatorProvider?: ITokenValidatorProvider
  ) {
    super(
      tokenProvider,
      chainId,
      Protocol.MIXED,
      blockedTokenListProvider,
      tokenValidatorProvider
    );
    this.stableSubgraphProvider = stableSubgraphProvider;
    this.stablePoolProvider = stablePoolProvider;
    this.v3SubgraphProvider = v3SubgraphProvider;
    this.v3PoolProvider = v3PoolProvider;
    this.onChainQuoteProvider = onChainQuoteProvider;
  }

  protected async getRoutes(
    tokenIn: NativeToken,
    tokenOut: NativeToken,
    uniqueCandidatePools: [V3CandidatePools, StableCandidatePools],
    tradeType: TradeType,
    routingConfig: AlphaRouterConfig
  ): Promise<GetRoutesResult<MixedRoute>> {
    const beforeGetRoutes = Date.now();

    if (tradeType != TradeType.EXACT_INPUT) {
      throw new Error('Mixed route quotes are not supported for EXACT_OUTPUT');
    }

    const [v3CandidatePools, stableCandidatePools] = uniqueCandidatePools;

    const {
      StablePoolAccessor,
      V3poolAccessor,
      candidatePools: mixedRouteCandidatePools,
    } = await getMixedRouteCandidatePools({
      stableCandidatePools,
      v3CandidatePools,
      tokenProvider: this.tokenProvider,
      v3poolProvider: this.v3PoolProvider,
      stablePoolProvider: this.stablePoolProvider,
      routingConfig,
      chainId: this.chainId,
    });

    const V3poolsRaw = V3poolAccessor.getAllPools();
    const StablePoolsRaw = StablePoolAccessor.getAllPools();

    const poolsRaw = [...V3poolsRaw, ...StablePoolsRaw];

    const candidatePools = mixedRouteCandidatePools;

    // Drop any pools that contain fee on transfer tokens (not supported by v3) or have issues with being transferred.
    const pools = await this.applyTokenValidatorToPools(
      poolsRaw,
      (
        token: Currency,
        tokenValidation: TokenValidationResult | undefined
      ): boolean => {
        // If there is no available validation result we assume the token is fine.
        if (!tokenValidation) {
          return false;
        }

        // Only filters out *intermediate* pools that involve tokens that we detect
        // cant be transferred. This prevents us trying to route through tokens that may
        // not be transferrable, but allows users to still swap those tokens if they
        // specify.
        //
        if (
          tokenValidation == TokenValidationResult.STF &&
          (token.equals(tokenIn) || token.equals(tokenOut))
        ) {
          return false;
        }

        return (
          tokenValidation == TokenValidationResult.FOT ||
          tokenValidation == TokenValidationResult.STF
        );
      }
    );

    const { maxSwapsPerPath } = routingConfig;

    const routes = computeAllMixedRoutes(
      tokenIn,
      tokenOut,
      pools,
      maxSwapsPerPath
    );

    metric.putMetric(
      'MixedGetRoutesLoad',
      Date.now() - beforeGetRoutes,
      MetricLoggerUnit.Milliseconds
    );

    return {
      routes,
      candidatePools,
    };
  }

  public async getQuotes(
    routes: MixedRoute[],
    amounts: CurrencyAmount[],
    percents: number[],
    quoteToken: NativeToken,
    tradeType: TradeType,
    routingConfig: AlphaRouterConfig,
    candidatePools?: CandidatePoolsBySelectionCriteria,
    gasModel?: IGasModel<MixedRouteWithValidQuote>
  ): Promise<GetQuotesResult> {
    const beforeGetQuotes = Date.now();
    log.info('Starting to get mixed quotes');
    if (gasModel === undefined) {
      throw new Error(
        'GasModel for MixedRouteWithValidQuote is required to getQuotes'
      );
    }
    if (routes.length == 0) {
      return { routesWithValidQuotes: [], candidatePools };
    }

    // For all our routes, and all the fractional amounts, fetch quotes on-chain.
    const quoteFn = this.onChainQuoteProvider.getQuotesManyExactIn.bind(
      this.onChainQuoteProvider
    );

    const beforeQuotes = Date.now();
    log.info(
      `Getting quotes for mixed for ${routes.length} routes with ${amounts.length} amounts per route.`
    );

    const { routesWithQuotes } = await quoteFn<MixedRoute>(amounts, routes, {
      blockNumber: routingConfig.blockNumber,
    });

    metric.putMetric(
      'MixedQuotesLoad',
      Date.now() - beforeQuotes,
      MetricLoggerUnit.Milliseconds
    );

    metric.putMetric(
      'MixedQuotesFetched',
      _(routesWithQuotes)
        .map(([, quotes]) => quotes.length)
        .sum(),
      MetricLoggerUnit.Count
    );

    const routesWithValidQuotes = [];

    for (const routeWithQuote of routesWithQuotes) {
      const [route, quotes] = routeWithQuote;

      for (let i = 0; i < quotes.length; i++) {
        const percent = percents[i]!;
        const amountQuote = quotes[i]!;
        const { quote, amount } = amountQuote;

        if (!quote) {
          log.debug(
            {
              route: routeToString(route),
              amountQuote,
            },
            'Dropping a null mixed quote for route.'
          );
          continue;
        }

        const routeWithValidQuote = new MixedRouteWithValidQuote({
          route,
          rawQuote: quote,
          amount,
          percent,
          sqrtPriceX96AfterList: [],
          initializedTicksCrossedList: [],
          mixedRouteGasModel: gasModel,
          quoteToken,
          tradeType,
          v3PoolProvider: this.v3PoolProvider,
        });

        routesWithValidQuotes.push(routeWithValidQuote);
      }
    }

    metric.putMetric(
      'MixedGetQuotesLoad',
      Date.now() - beforeGetQuotes,
      MetricLoggerUnit.Milliseconds
    );

    return {
      routesWithValidQuotes,
      candidatePools,
    };
  }
}

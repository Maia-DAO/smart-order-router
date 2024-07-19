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
  TokenValidationResult,
} from '../../../providers';
import {
  CurrencyAmount,
  MetricLoggerUnit,
  log,
  metric,
  routeToString,
} from '../../../util';
import { StableRoute } from '../../router';
import { AlphaRouterConfig } from '../alpha-router';
import { StableRouteWithValidQuote } from '../entities';
import { computeAllStableRoutes } from '../functions/compute-all-routes';
import {
  CandidatePoolsBySelectionCriteria,
  StableCandidatePools,
} from '../functions/get-candidate-pools';
import { IGasModel } from '../gas-models';
import { BaseQuoter } from './base-quoter';
import { GetQuotesResult } from './model/results/get-quotes-result';
import { GetRoutesResult } from './model/results/get-routes-result';

export class StableQuoter extends BaseQuoter<
  StableCandidatePools,
  StableRoute
> {
  protected stableSubgraphProvider: IStableSubgraphProvider;
  protected stablePoolProvider: IStablePoolProvider;
  protected onChainQuoteProvider: IOnChainQuoteProvider;

  constructor(
    stableSubgraphProvider: IStableSubgraphProvider,
    stablePoolProvider: IStablePoolProvider,
    onChainQuoteProvider: IOnChainQuoteProvider,
    tokenProvider: ITokenProvider,
    chainId: ChainId,
    blockedTokenListProvider?: ITokenListProvider,
    tokenValidatorProvider?: ITokenValidatorProvider
  ) {
    super(
      tokenProvider,
      chainId,
      Protocol.BAL_STABLE,
      blockedTokenListProvider,
      tokenValidatorProvider
    );
    this.stableSubgraphProvider = stableSubgraphProvider;
    this.stablePoolProvider = stablePoolProvider;
    this.onChainQuoteProvider = onChainQuoteProvider;
  }

  protected async getRoutes(
    tokenIn: NativeToken,
    tokenOut: NativeToken,
    stableCandidatePools: StableCandidatePools,
    _tradeType: TradeType,
    routingConfig: AlphaRouterConfig
  ): Promise<GetRoutesResult<StableRoute>> {
    const beforeGetRoutes = Date.now();
    // Fetch all the pools that we will consider routing via. There are thousands
    // of pools, so we filter them to a set of candidate pools that we expect will
    // result in good prices.
    const { poolAccessor, candidatePools } = stableCandidatePools;
    const poolsRaw = poolAccessor.getAllPools();

    // Drop any pools that contain fee on transfer tokens (not supported by stable router calcs) or have issues with being transferred.
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

    // Given all our candidate pools, compute all the possible ways to route from tokenIn to tokenOut.
    const { maxSwapsPerPath } = routingConfig;
    const routes = computeAllStableRoutes(
      tokenIn,
      tokenOut,
      pools,
      maxSwapsPerPath
    );

    metric.putMetric(
      'StableGetRoutesLoad',
      Date.now() - beforeGetRoutes,
      MetricLoggerUnit.Milliseconds
    );

    return {
      routes,
      candidatePools,
    };
  }

  public async getQuotes(
    routes: StableRoute[],
    amounts: CurrencyAmount[],
    percents: number[],
    quoteToken: NativeToken,
    tradeType: TradeType,
    routingConfig: AlphaRouterConfig,
    candidatePools?: CandidatePoolsBySelectionCriteria,
    gasModel?: IGasModel<StableRouteWithValidQuote>
  ): Promise<GetQuotesResult> {
    const beforeGetQuotes = Date.now();
    log.info('Starting to get Stable quotes');

    if (gasModel === undefined) {
      throw new Error(
        'GasModel for StableRouteWithValidQuote is required to getQuotes'
      );
    }

    if (routes.length == 0) {
      return { routesWithValidQuotes: [], candidatePools };
    }

    // TODO: Add support for exact out
    // const quoteFn =
    //   tradeType == TradeType.EXACT_INPUT
    //     ? this.onChainQuoteProvider.getQuotesManyExactIn.bind(
    //         this.onChainQuoteProvider
    //       )
    //     : this.onChainQuoteProvider.getQuotesManyExactOut.bind(
    //         this.onChainQuoteProvider
    //       );

    // For all our routes, and all the fractional amounts, fetch quotes on-chain.
    const quoteFn = this.onChainQuoteProvider.getQuotesManyExactIn.bind(
      this.onChainQuoteProvider
    );

    const beforeQuotes = Date.now();
    log.info(
      `Getting quotes for Stable for ${routes.length} routes with ${amounts.length} amounts per route.`
    );

    const { routesWithQuotes } = await quoteFn<StableRoute>(amounts, routes, {
      blockNumber: routingConfig.blockNumber,
    });

    metric.putMetric(
      'StableQuotesLoad',
      Date.now() - beforeQuotes,
      MetricLoggerUnit.Milliseconds
    );

    metric.putMetric(
      'StableQuotesFetched',
      _(routesWithQuotes)
        .map(([, quotes]) => quotes.length)
        .sum(),
      MetricLoggerUnit.Count
    );

    const routesWithValidQuotes: StableRouteWithValidQuote[] = [];

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
            'Dropping a null Stable quote for route.'
          );
          continue;
        }

        const routeWithValidQuote = new StableRouteWithValidQuote({
          route,
          rawQuote: quote,
          amount,
          percent,
          gasModel,
          quoteToken,
          tradeType,
        });

        routesWithValidQuotes.push(routeWithValidQuote);
      }
    }

    metric.putMetric(
      'StableGetQuotesLoad',
      Date.now() - beforeGetQuotes,
      MetricLoggerUnit.Milliseconds
    );

    return {
      routesWithValidQuotes,
      candidatePools,
    };
  }
}

import { BigNumber } from '@ethersproject/bignumber';
import { Logger } from '@ethersproject/logger';
import { SwapRouter, Trade } from 'hermes-swap-router-sdk';
import { FeeAmount, Pool, Route, TradeType } from 'hermes-v2-sdk';
import _ from 'lodash';
import {
  ChainId,
  Currency,
  MethodParameters,
  NativeToken,
} from 'maia-core-sdk';

import { IOnChainQuoteProvider, RouteWithQuotes } from '../../providers';
import { IMulticallProvider } from '../../providers/multicall-provider';
import {
  DAI_ARBITRUM,
  ITokenProvider,
  USDC_SEPOLIA,
} from '../../providers/token-provider';
import { IV3PoolProvider } from '../../providers/v3/pool-provider';
import { SWAP_ROUTER_02_ADDRESSES } from '../../util';
import { CurrencyAmount } from '../../util/amounts';
import { log } from '../../util/log';
import { routeToString } from '../../util/routes';
import { V3RouteWithValidQuote } from '../alpha-router';
import { SwapOptionsSwapRouter02, SwapRoute, V3Route } from '../router';

import {
  ADDITIONAL_BASES,
  BASES_TO_CHECK_TRADES_AGAINST,
  CUSTOM_BASES,
} from './bases';

export type LegacyRouterParams = {
  chainId: ChainId;
  multicall2Provider: IMulticallProvider;
  poolProvider: IV3PoolProvider;
  quoteProvider: IOnChainQuoteProvider;
  tokenProvider: ITokenProvider;
};

// Interface defaults to 2.
const MAX_HOPS = 2;

export type LegacyRoutingConfig = {
  blockNumber?: number;
};

/**
 * Replicates the router implemented in the V3 interface.
 * Code is mostly a copy from https://github.com/Uniswap/uniswap-interface/blob/0190b5a408c13016c87e1030ffc59326c085f389/src/hooks/useBestV3Trade.ts#L22-L23
 * with React/Redux hooks removed, and refactoring to allow re-use in other routers.
 */
export class LegacyRouter {
  protected chainId: ChainId;
  protected multicall2Provider: IMulticallProvider;
  protected poolProvider: IV3PoolProvider;
  protected quoteProvider: IOnChainQuoteProvider;
  protected tokenProvider: ITokenProvider;

  constructor({
    chainId,
    multicall2Provider,
    poolProvider,
    quoteProvider,
    tokenProvider,
  }: LegacyRouterParams) {
    this.chainId = chainId;
    this.multicall2Provider = multicall2Provider;
    this.poolProvider = poolProvider;
    this.quoteProvider = quoteProvider;
    this.tokenProvider = tokenProvider;
  }
  public async route(
    amount: CurrencyAmount,
    quoteCurrency: Currency,
    swapType: TradeType,
    swapConfig?: SwapOptionsSwapRouter02,
    partialRoutingConfig?: Partial<LegacyRoutingConfig>
  ): Promise<SwapRoute | null> {
    if (swapType == TradeType.EXACT_INPUT) {
      return this.routeExactIn(
        amount.currency,
        quoteCurrency,
        amount,
        swapConfig,
        partialRoutingConfig
      );
    }

    return this.routeExactOut(
      quoteCurrency,
      amount.currency,
      amount,
      swapConfig,
      partialRoutingConfig
    );
  }

  public async routeExactIn(
    currencyIn: Currency,
    currencyOut: Currency,
    amountIn: CurrencyAmount,
    swapConfig?: SwapOptionsSwapRouter02,
    routingConfig?: LegacyRoutingConfig
  ): Promise<SwapRoute | null> {
    const tokenIn = currencyIn.wrapped;
    const tokenOut = currencyOut.wrapped;
    const routes = await this.getAllRoutes(tokenIn, tokenOut, routingConfig);
    const routeQuote = await this.findBestRouteExactIn(
      amountIn,
      tokenOut,
      routes,
      routingConfig
    );

    if (!routeQuote) {
      return null;
    }

    const trade = this.buildTrade<TradeType.EXACT_INPUT>(
      currencyIn,
      currencyOut,
      TradeType.EXACT_INPUT,
      routeQuote
    );

    return {
      quote: routeQuote.quote,
      quoteGasAdjusted: routeQuote.quote,
      route: [routeQuote],
      estimatedGasUsed: BigNumber.from(0),
      estimatedGasUsedQuoteToken: CurrencyAmount.fromFractionalAmount(
        tokenOut,
        0,
        1
      ),
      estimatedGasUsedUSD: CurrencyAmount.fromFractionalAmount(
        DAI_ARBITRUM!,
        0,
        1
      ),
      gasPriceWei: BigNumber.from(0),
      trade,
      methodParameters: swapConfig
        ? {
            ...this.buildMethodParameters(trade, swapConfig),
            to: SWAP_ROUTER_02_ADDRESSES(this.chainId),
          }
        : undefined,
      blockNumber: BigNumber.from(0),
    };
  }

  public async routeExactOut(
    currencyIn: Currency,
    currencyOut: Currency,
    amountOut: CurrencyAmount,
    swapConfig?: SwapOptionsSwapRouter02,
    routingConfig?: LegacyRoutingConfig
  ): Promise<SwapRoute | null> {
    const tokenIn = currencyIn.wrapped;
    const tokenOut = currencyOut.wrapped;
    const routes = await this.getAllRoutes(tokenIn, tokenOut, routingConfig);
    const routeQuote = await this.findBestRouteExactOut(
      amountOut,
      tokenIn,
      routes,
      routingConfig
    );

    if (!routeQuote) {
      return null;
    }

    const trade = this.buildTrade<TradeType.EXACT_OUTPUT>(
      currencyIn,
      currencyOut,
      TradeType.EXACT_OUTPUT,
      routeQuote
    );

    return {
      quote: routeQuote.quote,
      quoteGasAdjusted: routeQuote.quote,
      route: [routeQuote],
      estimatedGasUsed: BigNumber.from(0),
      estimatedGasUsedQuoteToken: CurrencyAmount.fromFractionalAmount(
        tokenIn,
        0,
        1
      ),
      estimatedGasUsedUSD: CurrencyAmount.fromFractionalAmount(
        DAI_ARBITRUM,
        0,
        1
      ),
      gasPriceWei: BigNumber.from(0),
      trade,
      methodParameters: swapConfig
        ? {
            ...this.buildMethodParameters(trade, swapConfig),
            to: SWAP_ROUTER_02_ADDRESSES(this.chainId),
          }
        : undefined,
      blockNumber: BigNumber.from(0),
    };
  }

  private async findBestRouteExactIn(
    amountIn: CurrencyAmount,
    tokenOut: NativeToken,
    routes: V3Route[],
    routingConfig?: LegacyRoutingConfig
  ): Promise<V3RouteWithValidQuote | null> {
    const { routesWithQuotes: quotesRaw } =
      await this.quoteProvider.getQuotesManyExactIn<V3Route>(
        [amountIn],
        routes,
        {
          blockNumber: routingConfig?.blockNumber,
        }
      );

    const quotes100Percent = _.map(
      quotesRaw,
      ([route, quotes]: RouteWithQuotes<V3Route>) =>
        `${routeToString(route)} : ${quotes[0]?.quote?.toString()}`
    );
    log.info({ quotes100Percent }, '100% Quotes');

    const bestQuote = await this.getBestQuote(
      routes,
      quotesRaw,
      tokenOut,
      TradeType.EXACT_INPUT
    );

    return bestQuote;
  }

  private async findBestRouteExactOut(
    amountOut: CurrencyAmount,
    tokenIn: NativeToken,
    routes: V3Route[],
    routingConfig?: LegacyRoutingConfig
  ): Promise<V3RouteWithValidQuote | null> {
    const { routesWithQuotes: quotesRaw } =
      await this.quoteProvider.getQuotesManyExactOut<V3Route>(
        [amountOut],
        routes,
        {
          blockNumber: routingConfig?.blockNumber,
        }
      );
    const bestQuote = await this.getBestQuote(
      routes,
      quotesRaw,
      tokenIn,
      TradeType.EXACT_OUTPUT
    );

    return bestQuote;
  }

  private async getBestQuote(
    routes: V3Route[],
    quotesRaw: RouteWithQuotes<V3Route>[],
    quoteToken: NativeToken,
    routeType: TradeType
  ): Promise<V3RouteWithValidQuote | null> {
    log.debug(
      `Got ${
        _.filter(quotesRaw, ([_, quotes]) => !!quotes[0]).length
      } valid quotes from ${routes.length} possible routes.`
    );

    const routeQuotesRaw: {
      route: V3Route;
      quote: BigNumber;
      amount: CurrencyAmount;
    }[] = [];

    for (let i = 0; i < quotesRaw.length; i++) {
      const [route, quotes] = quotesRaw[i]!;
      const { quote, amount } = quotes[0]!;

      if (!quote) {
        Logger.globalLogger().debug(`No quote for ${routeToString(route)}`);
        continue;
      }

      routeQuotesRaw.push({ route, quote, amount });
    }

    if (routeQuotesRaw.length == 0) {
      return null;
    }

    routeQuotesRaw.sort((routeQuoteA, routeQuoteB) => {
      if (routeType == TradeType.EXACT_INPUT) {
        return routeQuoteA.quote.gt(routeQuoteB.quote) ? -1 : 1;
      } else {
        return routeQuoteA.quote.lt(routeQuoteB.quote) ? -1 : 1;
      }
    });

    const routeQuotes = _.map(routeQuotesRaw, ({ route, quote, amount }) => {
      return new V3RouteWithValidQuote({
        route,
        rawQuote: quote,
        amount,
        percent: 100,
        gasModel: {
          estimateGasCost: () => ({
            gasCostInToken: CurrencyAmount.fromRawAmount(quoteToken, 0),
            gasCostInUSD: CurrencyAmount.fromRawAmount(USDC_SEPOLIA, 0),
            gasEstimate: BigNumber.from(0),
          }),
        },
        sqrtPriceX96AfterList: [],
        initializedTicksCrossedList: [],
        quoterGasEstimate: BigNumber.from(0),
        tradeType: routeType,
        quoteToken,
        v3PoolProvider: this.poolProvider,
      });
    });

    for (const rq of routeQuotes) {
      log.debug(
        `Quote: ${rq.amount.toFixed(
          Math.min(rq.amount.currency.decimals, 2)
        )} Route: ${routeToString(rq.route)}`
      );
    }

    return routeQuotes[0]!;
  }

  private async getAllRoutes(
    tokenIn: NativeToken,
    tokenOut: NativeToken,
    routingConfig?: LegacyRoutingConfig
  ): Promise<V3Route[]> {
    const tokenPairs: [NativeToken, NativeToken, FeeAmount][] =
      await this.getAllPossiblePairings(tokenIn, tokenOut);

    const poolAccessor = await this.poolProvider.getPools(tokenPairs, {
      blockNumber: routingConfig?.blockNumber,
    });
    const pools = poolAccessor.getAllPools();

    const routes: V3Route[] = this.computeAllRoutes(
      tokenIn,
      tokenOut,
      pools,
      this.chainId,
      [],
      [],
      tokenIn,
      MAX_HOPS
    );

    log.info(
      { routes: _.map(routes, routeToString) },
      `Computed ${routes.length} possible routes.`
    );

    return routes;
  }

  private async getAllPossiblePairings(
    tokenIn: NativeToken,
    tokenOut: NativeToken
  ): Promise<[NativeToken, NativeToken, FeeAmount][]> {
    const common =
      BASES_TO_CHECK_TRADES_AGAINST(this.tokenProvider)[this.chainId] ?? [];
    const additionalA =
      (await ADDITIONAL_BASES(this.tokenProvider))[this.chainId]?.[
        tokenIn.address
      ] ?? [];
    const additionalB =
      (await ADDITIONAL_BASES(this.tokenProvider))[this.chainId]?.[
        tokenOut.address
      ] ?? [];
    const bases = [...common, ...additionalA, ...additionalB];

    const basePairs: [NativeToken, NativeToken][] = _.flatMap(
      bases,
      (base): [NativeToken, NativeToken][] =>
        bases.map((otherBase) => [base, otherBase])
    );

    const customBases = (await CUSTOM_BASES(this.tokenProvider))[this.chainId];

    const allPairs: [NativeToken, NativeToken, FeeAmount][] = _([
      // the direct pair
      [tokenIn, tokenOut],
      // token A against all bases
      ...bases.map((base): [NativeToken, NativeToken] => [tokenIn, base]),
      // token B against all bases
      ...bases.map((base): [NativeToken, NativeToken] => [tokenOut, base]),
      // each base against all bases
      ...basePairs,
    ])
      .filter((tokens): tokens is [NativeToken, NativeToken] =>
        Boolean(tokens[0] && tokens[1])
      )
      .filter(
        ([tokenA, tokenB]) =>
          tokenA.address !== tokenB.address && !tokenA.equals(tokenB)
      )
      .filter(([tokenA, tokenB]) => {
        const customBasesA: NativeToken[] | undefined =
          customBases?.[tokenA.address];
        const customBasesB: NativeToken[] | undefined =
          customBases?.[tokenB.address];

        if (!customBasesA && !customBasesB) return true;

        if (customBasesA && !customBasesA.find((base) => tokenB.equals(base)))
          return false;
        if (customBasesB && !customBasesB.find((base) => tokenA.equals(base)))
          return false;

        return true;
      })
      .flatMap<[NativeToken, NativeToken, FeeAmount]>(([tokenA, tokenB]) => {
        return [
          [tokenA, tokenB, FeeAmount.LOW],
          [tokenA, tokenB, FeeAmount.MEDIUM],
          [tokenA, tokenB, FeeAmount.HIGH],
        ];
      })
      .value();

    return allPairs;
  }

  private computeAllRoutes(
    tokenIn: NativeToken,
    tokenOut: NativeToken,
    pools: Pool[],
    chainId: ChainId,
    currentPath: Pool[] = [],
    allPaths: V3Route[] = [],
    startTokenIn: NativeToken = tokenIn,
    maxHops = 2
  ): V3Route[] {
    for (const pool of pools) {
      if (currentPath.indexOf(pool) !== -1 || !pool.involvesToken(tokenIn))
        continue;

      const outputToken = pool.token0.equals(tokenIn)
        ? pool.token1
        : pool.token0;
      if (outputToken.equals(tokenOut)) {
        allPaths.push(
          new V3Route([...currentPath, pool], startTokenIn, tokenOut)
        );
      } else if (maxHops > 1) {
        this.computeAllRoutes(
          outputToken,
          tokenOut,
          pools,
          chainId,
          [...currentPath, pool],
          allPaths,
          startTokenIn,
          maxHops - 1
        );
      }
    }

    return allPaths;
  }

  private buildTrade<TTradeType extends TradeType>(
    tokenInCurrency: Currency,
    tokenOutCurrency: Currency,
    tradeType: TTradeType,
    routeAmount: V3RouteWithValidQuote
  ): Trade<Currency, Currency, TTradeType> {
    const { route, amount, quote } = routeAmount;

    // The route, amount and quote are all in terms of wrapped tokens.
    // When constructing the Trade object the inputAmount/outputAmount must
    // use native currencies if necessary. This is so that the Trade knows to wrap/unwrap.
    if (tradeType == TradeType.EXACT_INPUT) {
      const amountCurrency = CurrencyAmount.fromFractionalAmount(
        tokenInCurrency,
        amount.numerator,
        amount.denominator
      );
      const quoteCurrency = CurrencyAmount.fromFractionalAmount(
        tokenOutCurrency,
        quote.numerator,
        quote.denominator
      );

      const routeCurrency = new Route(
        route.pools,
        amountCurrency.currency,
        quoteCurrency.currency
      );

      // TODO: Add more empty routes

      return new Trade({
        v3Routes: [
          {
            routev3: routeCurrency,
            inputAmount: amountCurrency,
            outputAmount: quoteCurrency,
          },
        ],
        v2Routes: [],
        stableRoutes: [],
        stableWrapperRoutes: [],
        tradeType: tradeType,
      });
    } else {
      const quoteCurrency = CurrencyAmount.fromFractionalAmount(
        tokenInCurrency,
        quote.numerator,
        quote.denominator
      );

      const amountCurrency = CurrencyAmount.fromFractionalAmount(
        tokenOutCurrency,
        amount.numerator,
        amount.denominator
      );

      const routeCurrency = new Route(
        route.pools,
        quoteCurrency.currency,
        amountCurrency.currency
      );

      // TODO: Add more empty routes

      return new Trade({
        v3Routes: [
          {
            routev3: routeCurrency,
            inputAmount: quoteCurrency,
            outputAmount: amountCurrency,
          },
        ],
        v2Routes: [],
        stableRoutes: [],
        stableWrapperRoutes: [],
        tradeType: tradeType,
      });
    }
  }

  private buildMethodParameters<TTradeType extends TradeType>(
    trade: Trade<Currency, Currency, TTradeType>,
    swapConfig: SwapOptionsSwapRouter02
  ): MethodParameters {
    const { recipient, slippageTolerance, deadline } = swapConfig;

    const methodParameters = SwapRouter.swapCallParameters(trade, {
      recipient,
      slippageTolerance,
      deadlineOrPreviousBlockhash: deadline,
      // ...(signatureData
      //   ? {
      //       inputTokenPermit:
      //         'allowed' in signatureData
      //           ? {
      //               expiry: signatureData.deadline,
      //               nonce: signatureData.nonce,
      //               s: signatureData.s,
      //               r: signatureData.r,
      //               v: signatureData.v as any,
      //             }
      //           : {
      //               deadline: signatureData.deadline,
      //               amount: signatureData.amount,
      //               s: signatureData.s,
      //               r: signatureData.r,
      //               v: signatureData.v as any,
      //             },
      //     }
      //   : {}),
    });

    return methodParameters;
  }
}

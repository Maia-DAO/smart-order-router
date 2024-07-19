import { BigNumber } from '@ethersproject/bignumber';
import { Protocol, TPool } from 'hermes-swap-router-sdk';
import { ComposableStablePool, Pool, TradeType, Vault } from 'hermes-v2-sdk';
import _ from 'lodash';
import { NativeToken } from 'maia-core-sdk';

import { IV2PoolProvider } from '../../../providers/v2/pool-provider';
import { IV3PoolProvider } from '../../../providers/v3/pool-provider';
import { CurrencyAmount } from '../../../util/amounts';
import { routeToString } from '../../../util/routes';
import {
  AllRoutes,
  MixedRoute,
  StableRoute,
  StableWrapperRoute,
  V2Route,
  V3Route,
} from '../../router';
import { IGasModel } from '../gas-models/gas-model';

/**
 * Represents a route, a quote for swapping some amount on it, and other
 * metadata used by the routing algorithm.
 *
 * @export
 * @interface IRouteWithValidQuote
 * @template Route
 */
export interface IRouteWithValidQuote<Route extends AllRoutes> {
  amount: CurrencyAmount;
  percent: number;
  // If exact in, this is (quote - gasCostInToken). If exact out, this is (quote + gasCostInToken).
  quoteAdjustedForGas: CurrencyAmount;
  quote: CurrencyAmount;
  route: Route;
  gasEstimate: BigNumber;
  // The gas cost in terms of the quote token.
  gasCostInToken: CurrencyAmount;
  gasCostInUSD: CurrencyAmount;
  gasCostInGasToken?: CurrencyAmount;
  tradeType: TradeType;
  poolAddresses: string[];
  tokenPath: NativeToken[];
}

// Discriminated unions on protocol field to narrow types.
export type IV2RouteWithValidQuote = {
  protocol: Protocol.V2;
} & IRouteWithValidQuote<V2Route>;

export type IV3RouteWithValidQuote = {
  protocol: Protocol.V3;
} & IRouteWithValidQuote<V3Route>;

export type IMixedRouteWithValidQuote = {
  protocol: Protocol.MIXED;
} & IRouteWithValidQuote<MixedRoute>;

export type IStableRouteWithValidQuote = {
  protocol: Protocol.BAL_STABLE;
} & IRouteWithValidQuote<StableRoute>;

export type IStableWrapperRouteWithValidQuote = {
  protocol: Protocol.BAL_STABLE_WRAPPER;
} & IRouteWithValidQuote<StableWrapperRoute>;

export type BaseRouteWithValidQuote =
  | V3RouteWithValidQuote
  | StableRouteWithValidQuote
  | StableWrapperRouteWithValidQuote;

export type RouteWithValidQuote =
  | V2RouteWithValidQuote
  | V3RouteWithValidQuote
  | StableRouteWithValidQuote
  | StableWrapperRouteWithValidQuote
  | MixedRouteWithValidQuote;

export type V2RouteWithValidQuoteParams = {
  amount: CurrencyAmount;
  rawQuote: BigNumber;
  percent: number;
  route: V2Route;
  gasModel: IGasModel<V2RouteWithValidQuote>;
  quoteToken: NativeToken;
  tradeType: TradeType;
  v2PoolProvider: IV2PoolProvider;
};
/**
 * Represents a quote for swapping on a V2 only route. Contains all information
 * such as the route used, the amount specified by the user, the type of quote
 * (exact in or exact out), the quote itself, and gas estimates.
 *
 * @export
 * @class V2RouteWithValidQuote
 */
export class V2RouteWithValidQuote implements IV2RouteWithValidQuote {
  public readonly protocol = Protocol.V2;
  public amount: CurrencyAmount;
  // The BigNumber representing the quote.
  public rawQuote: BigNumber;
  public quote: CurrencyAmount;
  public quoteAdjustedForGas: CurrencyAmount;
  public percent: number;
  public route: V2Route;
  public quoteToken: NativeToken;
  public gasModel: IGasModel<V2RouteWithValidQuote>;
  public gasEstimate: BigNumber;
  public gasCostInToken: CurrencyAmount;
  public gasCostInUSD: CurrencyAmount;
  public gasCostInGasToken?: CurrencyAmount;
  public tradeType: TradeType;
  public poolAddresses: string[];
  public tokenPath: NativeToken[];

  public toString(): string {
    return `${this.percent.toFixed(
      2
    )}% QuoteGasAdj[${this.quoteAdjustedForGas.toExact()}] Quote[${this.quote.toExact()}] Gas[${this.gasEstimate.toString()}] = ${routeToString(
      this.route
    )}`;
  }

  constructor({
    amount,
    rawQuote,
    percent,
    route,
    gasModel,
    quoteToken,
    tradeType,
    v2PoolProvider,
  }: V2RouteWithValidQuoteParams) {
    this.amount = amount;
    this.rawQuote = rawQuote;
    this.quote = CurrencyAmount.fromRawAmount(quoteToken, rawQuote.toString());
    this.percent = percent;
    this.route = route;
    this.gasModel = gasModel;
    this.quoteToken = quoteToken;
    this.tradeType = tradeType;

    const { gasEstimate, gasCostInToken, gasCostInUSD, gasCostInGasToken } =
      this.gasModel.estimateGasCost(this);

    this.gasCostInToken = gasCostInToken;
    this.gasCostInUSD = gasCostInUSD;
    this.gasEstimate = gasEstimate;
    this.gasCostInGasToken = gasCostInGasToken;

    // If its exact out, we need to request *more* of the input token to account for the gas.
    if (this.tradeType == TradeType.EXACT_INPUT) {
      const quoteGasAdjusted = this.quote.subtract(gasCostInToken);
      this.quoteAdjustedForGas = quoteGasAdjusted;
    } else {
      const quoteGasAdjusted = this.quote.add(gasCostInToken);
      this.quoteAdjustedForGas = quoteGasAdjusted;
    }

    this.poolAddresses = _.map(
      route.pairs,
      (p) => v2PoolProvider.getPoolAddress(p.token0, p.token1).poolAddress
    );

    this.tokenPath = this.route.path;
  }
}

export type V3RouteWithValidQuoteParams = {
  amount: CurrencyAmount;
  rawQuote: BigNumber;
  sqrtPriceX96AfterList: BigNumber[];
  initializedTicksCrossedList: number[];
  quoterGasEstimate: BigNumber;
  percent: number;
  route: V3Route;
  gasModel: IGasModel<V3RouteWithValidQuote>;
  quoteToken: NativeToken;
  tradeType: TradeType;
  v3PoolProvider: IV3PoolProvider;
};

/**
 * Represents a quote for swapping on a V3 only route. Contains all information
 * such as the route used, the amount specified by the user, the type of quote
 * (exact in or exact out), the quote itself, and gas estimates.
 *
 * @export
 * @class V3RouteWithValidQuote
 */
export class V3RouteWithValidQuote implements IV3RouteWithValidQuote {
  public readonly protocol = Protocol.V3;
  public amount: CurrencyAmount;
  public rawQuote: BigNumber;
  public quote: CurrencyAmount;
  public quoteAdjustedForGas: CurrencyAmount;
  public sqrtPriceX96AfterList: BigNumber[];
  public initializedTicksCrossedList: number[];
  public quoterGasEstimate: BigNumber;
  public percent: number;
  public route: V3Route;
  public quoteToken: NativeToken;
  public gasModel: IGasModel<V3RouteWithValidQuote>;
  public gasEstimate: BigNumber;
  public gasCostInToken: CurrencyAmount;
  public gasCostInUSD: CurrencyAmount;
  public gasCostInGasToken?: CurrencyAmount;
  public tradeType: TradeType;
  public poolAddresses: string[];
  public tokenPath: NativeToken[];

  public toString(): string {
    return `${this.percent.toFixed(
      2
    )}% QuoteGasAdj[${this.quoteAdjustedForGas.toExact()}] Quote[${this.quote.toExact()}] Gas[${this.gasEstimate.toString()}] = ${routeToString(
      this.route
    )}`;
  }

  constructor({
    amount,
    rawQuote,
    sqrtPriceX96AfterList,
    initializedTicksCrossedList,
    quoterGasEstimate,
    percent,
    route,
    gasModel,
    quoteToken,
    tradeType,
    v3PoolProvider,
  }: V3RouteWithValidQuoteParams) {
    this.amount = amount;
    this.rawQuote = rawQuote;
    this.sqrtPriceX96AfterList = sqrtPriceX96AfterList;
    this.initializedTicksCrossedList = initializedTicksCrossedList;
    this.quoterGasEstimate = quoterGasEstimate;
    this.quote = CurrencyAmount.fromRawAmount(quoteToken, rawQuote.toString());
    this.percent = percent;
    this.route = route;
    this.gasModel = gasModel;
    this.quoteToken = quoteToken;
    this.tradeType = tradeType;

    const { gasEstimate, gasCostInToken, gasCostInUSD, gasCostInGasToken } =
      this.gasModel.estimateGasCost(this);

    this.gasCostInToken = gasCostInToken;
    this.gasCostInUSD = gasCostInUSD;
    this.gasEstimate = gasEstimate;
    this.gasCostInGasToken = gasCostInGasToken;

    // If its exact out, we need to request *more* of the input token to account for the gas.
    if (this.tradeType == TradeType.EXACT_INPUT) {
      const quoteGasAdjusted = this.quote.subtract(gasCostInToken);
      this.quoteAdjustedForGas = quoteGasAdjusted;
    } else {
      const quoteGasAdjusted = this.quote.add(gasCostInToken);
      this.quoteAdjustedForGas = quoteGasAdjusted;
    }

    this.poolAddresses = _.map(
      route.pools,
      (p) =>
        v3PoolProvider.getPoolAddress(p.token0, p.token1, p.fee).poolAddress
    );

    this.tokenPath = this.route.tokenPath;
  }
}

export type StableRouteWithValidQuoteParams = {
  amount: CurrencyAmount;
  rawQuote: BigNumber;
  percent: number;
  route: StableRoute;
  gasModel: IGasModel<StableRouteWithValidQuote>;
  quoteToken: NativeToken;
  tradeType: TradeType;
};

/**
 * Represents a quote for swapping on a V3 only route. Contains all information
 * such as the route used, the amount specified by the user, the type of quote
 * (exact in or exact out), the quote itself, and gas estimates.
 *
 * @export
 * @class V3RouteWithValidQuote
 */
export class StableRouteWithValidQuote implements IStableRouteWithValidQuote {
  public readonly protocol = Protocol.BAL_STABLE;
  public amount: CurrencyAmount;
  public rawQuote: BigNumber;
  public quote: CurrencyAmount;
  public quoteAdjustedForGas: CurrencyAmount;
  public percent: number;
  public route: StableRoute;
  public quoteToken: NativeToken;
  public gasModel: IGasModel<StableRouteWithValidQuote>;
  public gasEstimate: BigNumber;
  public gasCostInToken: CurrencyAmount;
  public gasCostInUSD: CurrencyAmount;
  public gasCostInGasToken?: CurrencyAmount;
  public tradeType: TradeType;
  public poolAddresses: string[];
  public tokenPath: NativeToken[];

  public toString(): string {
    return `${this.percent.toFixed(
      2
    )}% QuoteGasAdj[${this.quoteAdjustedForGas.toExact()}] Quote[${this.quote.toExact()}] Gas[${this.gasEstimate.toString()}] = ${routeToString(
      this.route
    )}`;
  }

  constructor({
    amount,
    rawQuote,
    percent,
    route,
    gasModel,
    quoteToken,
    tradeType,
  }: StableRouteWithValidQuoteParams) {
    this.amount = amount;
    this.rawQuote = rawQuote;
    this.quote = CurrencyAmount.fromRawAmount(quoteToken, rawQuote.toString());
    this.percent = percent;
    this.route = route;
    this.gasModel = gasModel;
    this.quoteToken = quoteToken;
    this.tradeType = tradeType;

    const { gasEstimate, gasCostInToken, gasCostInUSD, gasCostInGasToken } =
      this.gasModel.estimateGasCost(this);

    this.gasCostInToken = gasCostInToken;
    this.gasCostInUSD = gasCostInUSD;
    this.gasEstimate = gasEstimate;
    this.gasCostInGasToken = gasCostInGasToken;

    // If its exact out, we need to request *more* of the input token to account for the gas.
    if (this.tradeType == TradeType.EXACT_INPUT) {
      const quoteGasAdjusted = this.quote.subtract(gasCostInToken);
      this.quoteAdjustedForGas = quoteGasAdjusted;
    } else {
      const quoteGasAdjusted = this.quote.add(gasCostInToken);
      this.quoteAdjustedForGas = quoteGasAdjusted;
    }

    this.poolAddresses = _.map(route.pools, (p) => p.pool.address);

    this.tokenPath = this.route.tokenPath;
  }
}

export type StableWrapperRouteWithValidQuoteParams = {
  amount: CurrencyAmount;
  rawQuote: BigNumber;
  percent: number;
  route: StableWrapperRoute;
  gasModel: IGasModel<StableWrapperRouteWithValidQuote>;
  quoteToken: NativeToken;
  tradeType: TradeType;
};

/**
 * Represents a quote for swapping on a V3 only route. Contains all information
 * such as the route used, the amount specified by the user, the type of quote
 * (exact in or exact out), the quote itself, and gas estimates.
 *
 * @export
 * @class V3RouteWithValidQuote
 */
export class StableWrapperRouteWithValidQuote
  implements IStableWrapperRouteWithValidQuote
{
  public readonly protocol = Protocol.BAL_STABLE_WRAPPER;
  public amount: CurrencyAmount;
  public rawQuote: BigNumber;
  public quote: CurrencyAmount;
  public quoteAdjustedForGas: CurrencyAmount;
  public percent: number;
  public route: StableWrapperRoute;
  public quoteToken: NativeToken;
  public gasModel: IGasModel<StableWrapperRouteWithValidQuote>;
  public gasEstimate: BigNumber;
  public gasCostInToken: CurrencyAmount;
  public gasCostInUSD: CurrencyAmount;
  public gasCostInGasToken?: CurrencyAmount;
  public tradeType: TradeType;
  public poolAddresses: string[];
  public tokenPath: NativeToken[];

  public toString(): string {
    return `${this.percent.toFixed(
      2
    )}% QuoteGasAdj[${this.quoteAdjustedForGas.toExact()}] Quote[${this.quote.toExact()}] Gas[${this.gasEstimate.toString()}] = ${routeToString(
      this.route
    )}`;
  }

  constructor({
    amount,
    rawQuote,
    percent,
    route,
    gasModel,
    quoteToken,
    tradeType,
  }: StableWrapperRouteWithValidQuoteParams) {
    this.amount = amount;
    this.rawQuote = rawQuote;
    this.quote = CurrencyAmount.fromRawAmount(quoteToken, rawQuote.toString());
    this.percent = percent;
    this.route = route;
    this.gasModel = gasModel;
    this.quoteToken = quoteToken;
    this.tradeType = tradeType;

    const { gasEstimate, gasCostInToken, gasCostInUSD, gasCostInGasToken } =
      this.gasModel.estimateGasCost(this);

    this.gasCostInToken = gasCostInToken;
    this.gasCostInUSD = gasCostInUSD;
    this.gasEstimate = gasEstimate;
    this.gasCostInGasToken = gasCostInGasToken;

    // If its exact out, we need to request *more* of the input token to account for the gas.
    if (this.tradeType == TradeType.EXACT_INPUT) {
      const quoteGasAdjusted = this.quote.subtract(gasCostInToken);
      this.quoteAdjustedForGas = quoteGasAdjusted;
    } else {
      const quoteGasAdjusted = this.quote.add(gasCostInToken);
      this.quoteAdjustedForGas = quoteGasAdjusted;
    }

    this.poolAddresses = _.map(route.pools, (p) => p.vault().address);

    this.tokenPath = this.route.tokenPath;
  }
}

export type MixedRouteWithValidQuoteParams = {
  amount: CurrencyAmount;
  rawQuote: BigNumber;
  sqrtPriceX96AfterList: BigNumber[];
  initializedTicksCrossedList: number[];
  percent: number;
  route: MixedRoute;
  mixedRouteGasModel: IGasModel<MixedRouteWithValidQuote>;
  quoteToken: NativeToken;
  tradeType: TradeType;
  v3PoolProvider: IV3PoolProvider;
};

/**
 * Represents a quote for swapping on a Mixed Route. Contains all information
 * such as the route used, the amount specified by the user, the type of quote
 * (exact in or exact out), the quote itself, and gas estimates.
 *
 * @export
 * @class MixedRouteWithValidQuote
 */
export class MixedRouteWithValidQuote implements IMixedRouteWithValidQuote {
  public readonly protocol = Protocol.MIXED;
  public amount: CurrencyAmount;
  public rawQuote: BigNumber;
  public quote: CurrencyAmount;
  public quoteAdjustedForGas: CurrencyAmount;
  public sqrtPriceX96AfterList: BigNumber[];
  public initializedTicksCrossedList: number[];
  public percent: number;
  public route: MixedRoute;
  public quoteToken: NativeToken;
  public gasModel: IGasModel<MixedRouteWithValidQuote>;
  public gasEstimate: BigNumber;
  public gasCostInToken: CurrencyAmount;
  public gasCostInUSD: CurrencyAmount;
  public gasCostInGasToken?: CurrencyAmount;
  public tradeType: TradeType;
  public poolAddresses: string[];
  public tokenPath: NativeToken[];

  public toString(): string {
    return `${this.percent.toFixed(
      2
    )}% QuoteGasAdj[${this.quoteAdjustedForGas.toExact()}] Quote[${this.quote.toExact()}] Gas[${this.gasEstimate?.toString()}] = ${routeToString(
      this.route
    )}`;
  }

  constructor({
    amount,
    rawQuote,
    sqrtPriceX96AfterList,
    initializedTicksCrossedList,
    percent,
    route,
    mixedRouteGasModel,
    quoteToken,
    tradeType,
    v3PoolProvider,
  }: MixedRouteWithValidQuoteParams) {
    this.amount = amount;
    this.rawQuote = rawQuote;
    this.sqrtPriceX96AfterList = sqrtPriceX96AfterList;
    this.initializedTicksCrossedList = initializedTicksCrossedList;
    this.quote = CurrencyAmount.fromRawAmount(quoteToken, rawQuote.toString());
    this.percent = percent;
    this.route = route;
    this.gasModel = mixedRouteGasModel;
    this.quoteToken = quoteToken;
    this.tradeType = tradeType;

    const { gasEstimate, gasCostInToken, gasCostInUSD, gasCostInGasToken } =
      this.gasModel.estimateGasCost(this);

    this.gasCostInToken = gasCostInToken;
    this.gasCostInUSD = gasCostInUSD;
    this.gasEstimate = gasEstimate;
    this.gasCostInGasToken = gasCostInGasToken;

    // If its exact out, we need to request *more* of the input token to account for the gas.
    if (this.tradeType == TradeType.EXACT_INPUT) {
      const quoteGasAdjusted = this.quote.subtract(gasCostInToken);
      this.quoteAdjustedForGas = quoteGasAdjusted;
    } else {
      const quoteGasAdjusted = this.quote.add(gasCostInToken);
      this.quoteAdjustedForGas = quoteGasAdjusted;
    }

    this.poolAddresses = _.map(route.pools, (p) => {
      return this.getPoolAddress(p, v3PoolProvider);
    });

    this.tokenPath = this.route.path;
  }

  private getPoolAddress(p: TPool, v3PoolProvider: IV3PoolProvider): string {
    if (p instanceof Pool)
      return v3PoolProvider.getPoolAddress(p.token0, p.token1, p.fee)
        .poolAddress;
    if (p instanceof ComposableStablePool) return p.pool.address;
    if (p instanceof Vault) return p.vault().address;

    throw new Error('Invalid pool type');
  }
}

import { BigNumber } from '@ethersproject/bignumber';
import { TPool } from 'hermes-swap-router-sdk';
import { Pool } from 'hermes-v2-sdk';
import {
  ChainId,
  CurrencyAmount as CurrencyAmountRaw,
  NativeToken,
} from 'maia-core-sdk';

import { ProviderConfig } from '../../../providers/provider';
import {
  DAI_ARBITRUM,
  USDC_ARBITRUM,
  USDC_SEPOLIA,
  USDT_ARBITRUM,
} from '../../../providers/token-provider';
import { IV2PoolProvider } from '../../../providers/v2/pool-provider';
import {
  ArbitrumGasData,
  IL2GasDataProvider,
  OptimismGasData,
} from '../../../providers/v3/gas-data-provider';
import { WRAPPED_NATIVE_CURRENCY } from '../../../util';
import { CurrencyAmount } from '../../../util/amounts';
import {
  MixedRouteWithValidQuote,
  RouteWithValidQuote,
  StableRouteWithValidQuote,
  StableWrapperRouteWithValidQuote,
  V2RouteWithValidQuote,
  V3RouteWithValidQuote,
} from '../entities/route-with-valid-quote';

// When adding new usd gas tokens, ensure the tokens are ordered
// from tokens with highest decimals to lowest decimals. For example,
// DAI_AVAX has 18 decimals and comes before USDC_AVAX which has 6 decimals.
export const usdGasTokensByChain: { [chainId in ChainId]?: NativeToken[] } = {
  [ChainId.ARBITRUM_ONE]: [DAI_ARBITRUM, USDC_ARBITRUM, USDT_ARBITRUM],
  [ChainId.SEPOLIA]: [USDC_SEPOLIA],
};

export type L1ToL2GasCosts = {
  gasUsedL1: BigNumber;
  gasUsedL1OnL2: BigNumber;
  gasCostL1USD: CurrencyAmount;
  gasCostL1QuoteToken: CurrencyAmount;
};

export type GasModelProviderConfig = ProviderConfig & {
  /*
   * Any additional overhead to add to the gas estimate
   */
  additionalGasOverhead?: BigNumber;

  gasToken?: NativeToken;
};

export type BuildOnChainGasModelFactoryType = {
  chainId: ChainId;
  gasPriceWei: BigNumber;
  pools: LiquidityCalculationPools;
  amountToken: NativeToken;
  quoteToken: NativeToken;
  l2GasDataProvider?:
    | IL2GasDataProvider<OptimismGasData>
    | IL2GasDataProvider<ArbitrumGasData>;
  providerConfig?: GasModelProviderConfig;
};

export type BuildV2GasModelFactoryType = {
  chainId: ChainId;
  gasPriceWei: BigNumber;
  poolProvider: IV2PoolProvider;
  token: NativeToken;
  providerConfig?: GasModelProviderConfig;
};

export type LiquidityCalculationPools = {
  usdPool: Pool;
  nativeAndQuoteTokenV3Pool: Pool | null;
  nativeAndAmountTokenV3Pool: Pool | null;
  nativeAndSpecifiedGasTokenV3Pool: Pool | null;
};

/**
 * Contains functions for generating gas estimates for given routes.
 *
 * We generally compute gas estimates off-chain because
 *  1/ Calling eth_estimateGas for a swaps requires the caller to have
 *     the full balance token being swapped, and approvals.
 *  2/ Tracking gas used using a wrapper contract is not accurate with Multicall
 *     due to EIP-2929
 *  3/ For V2 we simulate all our swaps off-chain so have no way to track gas used.
 *
 * Generally these models should be optimized to return quickly by performing any
 * long running operations (like fetching external data) outside of the functions defined.
 * This is because the functions in the model are called once for every route and every
 * amount that is considered in the algorithm so it is important to minimize the number of
 * long running operations.
 */
export type IGasModel<TRouteWithValidQuote extends RouteWithValidQuote> = {
  estimateGasCost(routeWithValidQuote: TRouteWithValidQuote): {
    gasEstimate: BigNumber;
    gasCostInToken: CurrencyAmount;
    gasCostInUSD: CurrencyAmount;
    gasCostInGasToken?: CurrencyAmount;
  };
  calculateL1GasFees?(routes: TRouteWithValidQuote[]): Promise<L1ToL2GasCosts>;
};

/**
 * Factory for building gas models that can be used with any route to generate
 * gas estimates.
 *
 * Factory model is used so that any supporting data can be fetched once and
 * returned as part of the model.
 *
 * @export
 * @abstract
 * @class IV2GasModelFactory
 */
export abstract class IV2GasModelFactory {
  public abstract buildGasModel({
    chainId,
    gasPriceWei,
    poolProvider,
    token,
    providerConfig,
  }: BuildV2GasModelFactoryType): Promise<IGasModel<V2RouteWithValidQuote>>;
}

/**
 * Factory for building gas models that can be used with any route to generate
 * gas estimates.
 *
 * Factory model is used so that any supporting data can be fetched once and
 * returned as part of the model.
 *
 * @export
 * @abstract
 * @class IOnChainGasModelFactory
 */
export abstract class IOnChainGasModelFactory {
  public abstract buildGasModel({
    chainId,
    gasPriceWei,
    pools,
    amountToken,
    quoteToken,
    l2GasDataProvider,
    providerConfig,
  }: BuildOnChainGasModelFactoryType): Promise<
    IGasModel<
      | StableWrapperRouteWithValidQuote
      | StableRouteWithValidQuote
      | V3RouteWithValidQuote
      | MixedRouteWithValidQuote
    >
  >;
}

// Determines if native currency is token0
// Gets the native price of the pool, dependent on 0 or 1
// quotes across the pool
export const getQuoteThroughNativePool = (
  chainId: ChainId,
  nativeTokenAmount: CurrencyAmountRaw<NativeToken>,
  nativeTokenPool: TPool
): CurrencyAmount => {
  const nativeCurrency = WRAPPED_NATIVE_CURRENCY[chainId];
  const isToken0 = nativeTokenPool.token0.equals(nativeCurrency);
  // returns mid price in terms of the native currency (the ratio of token/nativeToken)
  const nativeTokenPrice = isToken0
    ? nativeTokenPool.token0Price
    : nativeTokenPool.token1Price;
  // return gas cost in terms of the non native currency
  return nativeTokenPrice.quote(nativeTokenAmount) as CurrencyAmount;
};

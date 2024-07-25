import { Protocol } from 'hermes-swap-router-sdk';
import { FeeAmount, TradeType } from 'hermes-v2-sdk';
import _ from 'lodash';
import { ChainId, NativeToken } from 'maia-core-sdk';

import {
  IStableSubgraphProvider,
  ITokenListProvider,
  IV2SubgraphProvider,
  StableSubgraphPool,
  V2SubgraphPool,
} from '../../../providers';
import {
  IStablePoolProvider,
  StablePoolAccessor,
} from '../../../providers/stable/pool-provider';
import {
  DAI_ARBITRUM,
  DAI_SEPOLIA,
  ITokenProvider,
  USDC_ARBITRUM,
  USDC_SEPOLIA,
  USDT_ARBITRUM,
  USDT_SEPOLIA,
  WBTC_ARBITRUM,
  WuDAI_SEPOLIA,
  WuUSDC_SEPOLIA,
  WuUSDT_SEPOLIA,
} from '../../../providers/token-provider';
import {
  IV2PoolProvider,
  V2PoolAccessor,
} from '../../../providers/v2/pool-provider';
import {
  IV3PoolProvider,
  V3PoolAccessor,
} from '../../../providers/v3/pool-provider';
import {
  IV3SubgraphProvider,
  V3SubgraphPool,
} from '../../../providers/v3/subgraph-provider';
import { unparseFeeAmount, WRAPPED_NATIVE_CURRENCY } from '../../../util';
import { parseFeeAmount } from '../../../util/amounts';
import { log } from '../../../util/log';
import { metric, MetricLoggerUnit } from '../../../util/metric';
import { AlphaRouterConfig } from '../alpha-router';

export type PoolId = { id: string };
export type CandidatePoolsBySelectionCriteria = {
  protocol: Protocol;
  selections: CandidatePoolsSelections;
};

/// Utility type for allowing us to use `keyof CandidatePoolsSelections` to map
export type CandidatePoolsSelections = {
  topByBaseWithTokenIn: PoolId[];
  topByBaseWithTokenOut: PoolId[];
  topByDirectSwapPool: PoolId[];
  topByEthQuoteTokenPool: PoolId[];
  topByTVL: PoolId[];
  topByTVLUsingTokenIn: PoolId[];
  topByTVLUsingTokenOut: PoolId[];
  topByTVLUsingTokenInSecondHops: PoolId[];
  topByTVLUsingTokenOutSecondHops: PoolId[];
};

export type StableGetCandidatePoolsParams = {
  tokenIn: NativeToken;
  tokenOut: NativeToken;
  routeType: TradeType;
  routingConfig: AlphaRouterConfig;
  subgraphProvider: IStableSubgraphProvider;
  tokenProvider: ITokenProvider;
  poolProvider: IStablePoolProvider;
  blockedTokenListProvider?: ITokenListProvider;
  chainId: ChainId;
};

export type V3GetCandidatePoolsParams = {
  tokenIn: NativeToken;
  tokenOut: NativeToken;
  routeType: TradeType;
  routingConfig: AlphaRouterConfig;
  subgraphProvider: IV3SubgraphProvider;
  tokenProvider: ITokenProvider;
  poolProvider: IV3PoolProvider;
  blockedTokenListProvider?: ITokenListProvider;
  chainId: ChainId;
};

export type V2GetCandidatePoolsParams = {
  tokenIn: NativeToken;
  tokenOut: NativeToken;
  routeType: TradeType;
  routingConfig: AlphaRouterConfig;
  subgraphProvider: IV2SubgraphProvider;
  tokenProvider: ITokenProvider;
  poolProvider: IV2PoolProvider;
  blockedTokenListProvider?: ITokenListProvider;
  chainId: ChainId;
};

export type MixedRouteGetCandidatePoolsParams = {
  stableCandidatePools: StableCandidatePools;
  v3CandidatePools: V3CandidatePools;
  routingConfig: AlphaRouterConfig;
  tokenProvider: ITokenProvider;
  v3poolProvider: IV3PoolProvider;
  stablePoolProvider: IStablePoolProvider;
  blockedTokenListProvider?: ITokenListProvider;
  chainId: ChainId;
};

const baseTokensByChain: { [chainId in ChainId]?: NativeToken[] } = {
  [ChainId.SEPOLIA]: [
    WRAPPED_NATIVE_CURRENCY[ChainId.SEPOLIA]!,
    WuUSDC_SEPOLIA,
    WuDAI_SEPOLIA,
    WuUSDT_SEPOLIA,
    USDC_SEPOLIA,
    DAI_SEPOLIA,
    USDT_SEPOLIA,
  ],
  [ChainId.ARBITRUM_ONE]: [
    DAI_ARBITRUM,
    USDC_ARBITRUM,
    WBTC_ARBITRUM,
    USDT_ARBITRUM,
  ],
};

class SubcategorySelectionPools<SubgraphPool> {
  constructor(
    public pools: SubgraphPool[],
    public readonly poolsNeeded: number
  ) {}

  public hasEnoughPools(): boolean {
    return this.pools.length >= this.poolsNeeded;
  }
}

export type StableCandidatePools = {
  poolAccessor: StablePoolAccessor;
  candidatePools: CandidatePoolsBySelectionCriteria;
  subgraphPools: StableSubgraphPool[];
};

export async function getStableCandidatePools({
  tokenIn,
  tokenOut,
  routeType,
  routingConfig,
  subgraphProvider,
  tokenProvider,
  poolProvider,
  blockedTokenListProvider,
  chainId,
}: StableGetCandidatePoolsParams): Promise<StableCandidatePools> {
  const {
    blockNumber,
    stablePoolSelection: {
      topN,
      topNDirectSwaps,
      topNTokenInOut,
      topNSecondHop,
      topNSecondHopForTokenAddress,
      tokensToAvoidOnSecondHops,
      topNWithEachBaseToken,
      topNWithBaseToken,
    },
  } = routingConfig;
  const tokenInAddress = tokenIn.address.toLowerCase();
  const tokenOutAddress = tokenOut.address.toLowerCase();

  const beforeSubgraphPools = Date.now();

  const allPools = await subgraphProvider.getPools(tokenIn, tokenOut, {
    blockNumber,
  });

  log.info(
    { samplePools: allPools.slice(0, 3) },
    'Got all pools from Stable subgraph provider'
  );

  // Although this is less of an optimization than the V2 equivalent,
  // save some time copying objects by mutating the underlying pool directly.
  for (const pool of allPools) {
    pool.tokensList = pool.tokensList.map((token) => token.toLowerCase());
  }

  metric.putMetric(
    'StableSubgraphPoolsLoad',
    Date.now() - beforeSubgraphPools,
    MetricLoggerUnit.Milliseconds
  );

  const beforePoolsFiltered = Date.now();

  // Only consider pools where neither tokens are in the blocked token list.
  let filteredPools: StableSubgraphPool[] = allPools;
  if (blockedTokenListProvider) {
    filteredPools = [];
    for (const pool of allPools) {
      let isBlocked = false;
      for (const token of pool.tokensList) {
        if (await blockedTokenListProvider.hasTokenByAddress(token)) {
          isBlocked = true;
          break; // Exit the inner loop if a blocked token is found
        }
      }

      if (!isBlocked) {
        filteredPools.push(pool);
      }
    }
  }

  const subgraphPoolsSorted = filteredPools.sort((a, b) => b.tvlUSD - a.tvlUSD);

  log.info(
    `After filtering blocked tokens went from ${allPools.length} to ${subgraphPoolsSorted.length}.`
  );

  const poolAddressesSoFar = new Set<string>();
  const addToAddressSet = (pools: StableSubgraphPool[]) => {
    _(pools)
      .map((pool) => pool.id)
      .forEach((poolAddress) => poolAddressesSoFar.add(poolAddress));
  };

  const baseTokens = baseTokensByChain[chainId] ?? [];

  const topByBaseWithTokenIn = _(baseTokens)
    .flatMap((token: NativeToken) => {
      return _(subgraphPoolsSorted)
        .filter((subgraphPool) => {
          const tokenAddress = token.address.toLowerCase();
          return (
            subgraphPool.tokensList.some((token) => token == tokenAddress) &&
            (subgraphPool.tokensList.some((token) => token == tokenInAddress) ||
              subgraphPool.wrapper == tokenInAddress)
          );
        })
        .sortBy((tokenListPool) => -tokenListPool.tvlUSD)
        .slice(0, topNWithEachBaseToken)
        .value();
    })
    .sortBy((tokenListPool) => -tokenListPool.tvlUSD)
    .slice(0, topNWithBaseToken)
    .value();

  const topByBaseWithTokenOut = _(baseTokens)
    .flatMap((token: NativeToken) => {
      return _(subgraphPoolsSorted)
        .filter((subgraphPool) => {
          const tokenAddress = token.address.toLowerCase();
          return (
            subgraphPool.tokensList.some((token) => token == tokenAddress) &&
            (subgraphPool.tokensList.some(
              (token) => token == tokenOutAddress
            ) ||
              subgraphPool.wrapper == tokenInAddress)
          );
        })
        .sortBy((tokenListPool) => -tokenListPool.tvlUSD)
        .slice(0, topNWithEachBaseToken)
        .value();
    })
    .sortBy((tokenListPool) => -tokenListPool.tvlUSD)
    .slice(0, topNWithBaseToken)
    .value();

  const top2DirectSwapPool = _(subgraphPoolsSorted)
    .filter((subgraphPool) => {
      return (
        !poolAddressesSoFar.has(subgraphPool.id) &&
        subgraphPool.tokensList.some((token) => token == tokenInAddress) &&
        (subgraphPool.tokensList.some((token) => token == tokenOutAddress) ||
          subgraphPool.wrapper == tokenOutAddress)
      );
    })
    .slice(0, topNDirectSwaps)
    .value();

  // Can't guess Balancer's Pools, so ignore them if we don't have any direct swaps
  // if (top2DirectSwapPool.length == 0 && topNDirectSwaps > 0) {}

  addToAddressSet(top2DirectSwapPool);

  const wrappedNativeAddress =
    WRAPPED_NATIVE_CURRENCY[chainId]?.address.toLowerCase();

  // Main reason we need this is for gas estimates, only needed if token out is not native.
  // We don't check the seen address set because if we've already added pools for getting native quotes
  // theres no need to add more.
  let top2EthQuoteTokenPool: StableSubgraphPool[] = [];
  // TODO: Check if balancer's Vault address for the native token is the same as the wrapped native token address
  if (
    WRAPPED_NATIVE_CURRENCY[chainId]?.symbol ==
      WRAPPED_NATIVE_CURRENCY[ChainId.MAINNET]?.symbol &&
    tokenOut.symbol != 'WETH' &&
    tokenOut.symbol != 'WETH9' &&
    tokenOut.symbol != 'ETH'
  ) {
    top2EthQuoteTokenPool = _(subgraphPoolsSorted)
      .filter((subgraphPool) => {
        if (routeType == TradeType.EXACT_INPUT) {
          return (
            subgraphPool.tokensList.some(
              (token) => token == wrappedNativeAddress
            ) &&
            (subgraphPool.tokensList.some(
              (token) => token == tokenOutAddress
            ) ||
              subgraphPool.wrapper == tokenOutAddress)
          );
        } else {
          return (
            subgraphPool.tokensList.some(
              (token) => token == wrappedNativeAddress
            ) &&
            (subgraphPool.tokensList.some((token) => token == tokenInAddress) ||
              subgraphPool.wrapper == tokenInAddress)
          );
        }
      })
      .slice(0, 1)
      .value();
  }

  addToAddressSet(top2EthQuoteTokenPool);

  const topByTVL = _(subgraphPoolsSorted)
    .filter((subgraphPool) => {
      return !poolAddressesSoFar.has(subgraphPool.id);
    })
    .slice(0, topN)
    .value();

  addToAddressSet(topByTVL);

  const topByTVLUsingTokenIn = _(subgraphPoolsSorted)
    .filter((subgraphPool) => {
      return (
        !poolAddressesSoFar.has(subgraphPool.id) &&
        (subgraphPool.tokensList.some((token) => token == tokenInAddress) ||
          subgraphPool.wrapper == tokenInAddress)
      );
    })
    .slice(0, topNTokenInOut)
    .value();

  addToAddressSet(topByTVLUsingTokenIn);

  const topByTVLUsingTokenOut = _(subgraphPoolsSorted)
    .filter((subgraphPool) => {
      return (
        !poolAddressesSoFar.has(subgraphPool.id) &&
        (subgraphPool.tokensList.some((token) => token == tokenOutAddress) ||
          subgraphPool.wrapper == tokenInAddress)
      );
    })
    .slice(0, topNTokenInOut)
    .value();

  addToAddressSet(topByTVLUsingTokenOut);

  const topByTVLUsingTokenInSecondHops = _(topByTVLUsingTokenIn)
    .map((subgraphPool) => {
      // TODO
      return subgraphPool.tokensList.filter(
        (token) => token !== tokenInAddress
      );
    })
    .flatten() // Flatten the array of arrays into a single array
    .flatMap((secondHopId: string) => {
      return _(subgraphPoolsSorted)
        .filter((subgraphPool) => {
          return (
            !poolAddressesSoFar.has(subgraphPool.id) &&
            !tokensToAvoidOnSecondHops?.includes(secondHopId.toLowerCase()) &&
            (subgraphPool.tokensList.some((token) => token === secondHopId) ||
              subgraphPool.wrapper == secondHopId)
          );
        })
        .slice(
          0,
          topNSecondHopForTokenAddress?.get(secondHopId) ?? topNSecondHop
        )
        .value();
    })
    .uniqBy((pool) => pool.id)
    .value();

  addToAddressSet(topByTVLUsingTokenInSecondHops);

  const topByTVLUsingTokenOutSecondHops = _(topByTVLUsingTokenOut)
    .map((subgraphPool) => {
      // TODO
      return subgraphPool.tokensList.filter(
        (token) => token !== tokenOutAddress
      );
    })
    .flatten() // Flatten the array of arrays into a single array
    .flatMap((secondHopId: string) => {
      return _(subgraphPoolsSorted)
        .filter((subgraphPool) => {
          return (
            !poolAddressesSoFar.has(subgraphPool.id) &&
            !tokensToAvoidOnSecondHops?.includes(secondHopId.toLowerCase()) &&
            (subgraphPool.tokensList.some((token) => token === secondHopId) ||
              subgraphPool.wrapper == secondHopId)
          );
        })
        .slice(
          0,
          topNSecondHopForTokenAddress?.get(secondHopId) ?? topNSecondHop
        )
        .value();
    })
    .uniqBy((pool) => pool.id)
    .value();

  addToAddressSet(topByTVLUsingTokenOutSecondHops);

  const subgraphPools = _([
    ...topByBaseWithTokenIn,
    ...topByBaseWithTokenOut,
    ...top2DirectSwapPool,
    ...top2EthQuoteTokenPool,
    ...topByTVL,
    ...topByTVLUsingTokenIn,
    ...topByTVLUsingTokenOut,
    ...topByTVLUsingTokenInSecondHops,
    ...topByTVLUsingTokenOutSecondHops,
  ])
    .compact()
    .uniqBy((pool) => pool.id)
    .value();

  const tokenAddresses = _(subgraphPools)
    .flatMap((subgraphPool) => [
      ...subgraphPool.tokensList,
      subgraphPool.wrapper,
    ])
    .compact()
    .uniq()
    .value();

  log.info(
    `Getting the ${tokenAddresses.length} tokens within the ${subgraphPools.length} Stable pools we are considering`
  );

  const tokenAccessor = await tokenProvider.getTokens(tokenAddresses, {
    blockNumber,
  });

  const printStableSubgraphPool = (s: StableSubgraphPool) => `${s.id}`;

  log.info(
    {
      topByBaseWithTokenIn: topByBaseWithTokenIn.map(printStableSubgraphPool),
      topByBaseWithTokenOut: topByBaseWithTokenOut.map(printStableSubgraphPool),
      topByTVL: topByTVL.map(printStableSubgraphPool),
      topByTVLUsingTokenIn: topByTVLUsingTokenIn.map(printStableSubgraphPool),
      topByTVLUsingTokenOut: topByTVLUsingTokenOut.map(printStableSubgraphPool),
      topByTVLUsingTokenInSecondHops: topByTVLUsingTokenInSecondHops.map(
        printStableSubgraphPool
      ),
      topByTVLUsingTokenOutSecondHops: topByTVLUsingTokenOutSecondHops.map(
        printStableSubgraphPool
      ),
      top2DirectSwap: top2DirectSwapPool.map(printStableSubgraphPool),
      top2EthQuotePool: top2EthQuoteTokenPool.map(printStableSubgraphPool),
    },
    `Stable Candidate Pools`
  );

  const tokenPairsRaw = _.map<
    StableSubgraphPool,
    [string, NativeToken[], NativeToken?] | undefined
  >(subgraphPools, (subgraphPool) => {
    const tokens = subgraphPool.tokensList.map((token) =>
      tokenAccessor.getTokenByAddress(token)
    );
    const wrapper = subgraphPool.wrapper
      ? tokenAccessor.getTokenByAddress(subgraphPool.wrapper)
      : undefined;

    // Check if any token is undefined
    if (tokens.some((token) => token === undefined)) {
      const missingTokenId = subgraphPool.tokensList!.find(
        (token) => tokenAccessor.getTokenByAddress(token) === undefined
      );
      log.info(
        `Dropping candidate pool for ${subgraphPool.id} because token ${missingTokenId} not found by token provider`
      );
      return undefined;
    }

    return [subgraphPool.id, tokens as NativeToken[], wrapper];
  });

  const tokenPairs = _.compact(tokenPairsRaw);

  metric.putMetric(
    'StablePoolsFilterLoad',
    Date.now() - beforePoolsFiltered,
    MetricLoggerUnit.Milliseconds
  );

  const beforePoolsLoad = Date.now();

  const poolAccessor = await poolProvider.getPools(tokenPairs, {
    blockNumber,
  });

  metric.putMetric(
    'StablePoolsLoad',
    Date.now() - beforePoolsLoad,
    MetricLoggerUnit.Milliseconds
  );

  const poolsBySelection: CandidatePoolsBySelectionCriteria = {
    protocol: Protocol.BAL_STABLE,
    selections: {
      topByBaseWithTokenIn,
      topByBaseWithTokenOut,
      topByDirectSwapPool: top2DirectSwapPool,
      topByEthQuoteTokenPool: top2EthQuoteTokenPool,
      topByTVL,
      topByTVLUsingTokenIn,
      topByTVLUsingTokenOut,
      topByTVLUsingTokenInSecondHops,
      topByTVLUsingTokenOutSecondHops,
    },
  };

  return { poolAccessor, candidatePools: poolsBySelection, subgraphPools };
}

export type V3CandidatePools = {
  poolAccessor: V3PoolAccessor;
  candidatePools: CandidatePoolsBySelectionCriteria;
  subgraphPools: V3SubgraphPool[];
};

export async function getV3CandidatePools({
  tokenIn,
  tokenOut,
  routeType,
  routingConfig,
  subgraphProvider,
  tokenProvider,
  poolProvider,
  blockedTokenListProvider,
  chainId,
}: V3GetCandidatePoolsParams): Promise<V3CandidatePools> {
  const {
    blockNumber,
    v3PoolSelection: {
      topN,
      topNDirectSwaps,
      topNTokenInOut,
      topNSecondHop,
      topNSecondHopForTokenAddress,
      tokensToAvoidOnSecondHops,
      topNWithEachBaseToken,
      topNWithBaseToken,
    },
  } = routingConfig;
  const tokenInAddress = tokenIn.address.toLowerCase();
  const tokenOutAddress = tokenOut.address.toLowerCase();

  const beforeSubgraphPools = Date.now();

  const allPools = await subgraphProvider.getPools(tokenIn, tokenOut, {
    blockNumber,
  });

  log.info(
    { samplePools: allPools.slice(0, 3) },
    'Got all pools from V3 subgraph provider'
  );

  // Although this is less of an optimization than the V2 equivalent,
  // save some time copying objects by mutating the underlying pool directly.
  for (const pool of allPools) {
    pool.token0.id = pool.token0.id.toLowerCase();
    pool.token1.id = pool.token1.id.toLowerCase();
  }

  metric.putMetric(
    'V3SubgraphPoolsLoad',
    Date.now() - beforeSubgraphPools,
    MetricLoggerUnit.Milliseconds
  );

  const beforePoolsFiltered = Date.now();

  // Only consider pools where neither tokens are in the blocked token list.
  let filteredPools: V3SubgraphPool[] = allPools;
  if (blockedTokenListProvider) {
    filteredPools = [];
    for (const pool of allPools) {
      const token0InBlocklist =
        await blockedTokenListProvider.hasTokenByAddress(pool.token0.id);
      const token1InBlocklist =
        await blockedTokenListProvider.hasTokenByAddress(pool.token1.id);

      if (token0InBlocklist || token1InBlocklist) {
        continue;
      }

      filteredPools.push(pool);
    }
  }

  // Sort by tvlUSD in descending order
  const subgraphPoolsSorted = filteredPools.sort((a, b) => b.tvlUSD - a.tvlUSD);

  log.info(
    `After filtering blocked tokens went from ${allPools.length} to ${subgraphPoolsSorted.length}.`
  );

  const poolAddressesSoFar = new Set<string>();
  const addToAddressSet = (pools: V3SubgraphPool[]) => {
    _(pools)
      .map((pool) => pool.id)
      .forEach((poolAddress) => poolAddressesSoFar.add(poolAddress));
  };

  const baseTokens = baseTokensByChain[chainId] ?? [];

  const topByBaseWithTokenIn = _(baseTokens)
    .flatMap((token: NativeToken) => {
      return _(subgraphPoolsSorted)
        .filter((subgraphPool) => {
          const tokenAddress = token.address.toLowerCase();
          return (
            (subgraphPool.token0.id == tokenAddress &&
              subgraphPool.token1.id == tokenInAddress) ||
            (subgraphPool.token1.id == tokenAddress &&
              subgraphPool.token0.id == tokenInAddress)
          );
        })
        .sortBy((tokenListPool) => -tokenListPool.tvlUSD)
        .slice(0, topNWithEachBaseToken)
        .value();
    })
    .sortBy((tokenListPool) => -tokenListPool.tvlUSD)
    .slice(0, topNWithBaseToken)
    .value();

  const topByBaseWithTokenOut = _(baseTokens)
    .flatMap((token: NativeToken) => {
      return _(subgraphPoolsSorted)
        .filter((subgraphPool) => {
          const tokenAddress = token.address.toLowerCase();
          return (
            (subgraphPool.token0.id == tokenAddress &&
              subgraphPool.token1.id == tokenOutAddress) ||
            (subgraphPool.token1.id == tokenAddress &&
              subgraphPool.token0.id == tokenOutAddress)
          );
        })
        .sortBy((tokenListPool) => -tokenListPool.tvlUSD)
        .slice(0, topNWithEachBaseToken)
        .value();
    })
    .sortBy((tokenListPool) => -tokenListPool.tvlUSD)
    .slice(0, topNWithBaseToken)
    .value();

  let top2DirectSwapPool = _(subgraphPoolsSorted)
    .filter((subgraphPool) => {
      return (
        !poolAddressesSoFar.has(subgraphPool.id) &&
        ((subgraphPool.token0.id == tokenInAddress &&
          subgraphPool.token1.id == tokenOutAddress) ||
          (subgraphPool.token1.id == tokenInAddress &&
            subgraphPool.token0.id == tokenOutAddress))
      );
    })
    .slice(0, topNDirectSwaps)
    .value();

  if (top2DirectSwapPool.length == 0 && topNDirectSwaps > 0) {
    // If we requested direct swap pools but did not find any in the subgraph query.
    // Optimistically add them into the query regardless. Invalid pools ones will be dropped anyway
    // when we query the pool on-chain. Ensures that new pools for new pairs can be swapped on immediately.
    top2DirectSwapPool = _.map(
      [FeeAmount.HIGH, FeeAmount.MEDIUM, FeeAmount.LOW, FeeAmount.LOWEST],
      (feeAmount) => {
        const { token0, token1, poolAddress } = poolProvider.getPoolAddress(
          tokenIn,
          tokenOut,
          feeAmount
        );
        return {
          id: poolAddress,
          feeTier: unparseFeeAmount(feeAmount),
          liquidity: '10000',
          token0: {
            id: token0.address,
          },
          token1: {
            id: token1.address,
          },
          tvlETH: 10000,
          tvlUSD: 10000,
        };
      }
    );
  }

  addToAddressSet(top2DirectSwapPool);

  const wrappedNativeAddress =
    WRAPPED_NATIVE_CURRENCY[chainId]?.address.toLowerCase();

  // Main reason we need this is for gas estimates, only needed if token out is not native.
  // We don't check the seen address set because if we've already added pools for getting native quotes
  // theres no need to add more.
  let top2EthQuoteTokenPool: V3SubgraphPool[] = [];
  if (
    WRAPPED_NATIVE_CURRENCY[chainId]?.symbol ==
      WRAPPED_NATIVE_CURRENCY[ChainId.MAINNET]?.symbol &&
    tokenOut.symbol != 'WETH' &&
    tokenOut.symbol != 'WETH9' &&
    tokenOut.symbol != 'ETH'
  ) {
    top2EthQuoteTokenPool = _(subgraphPoolsSorted)
      .filter((subgraphPool) => {
        if (routeType == TradeType.EXACT_INPUT) {
          return (
            (subgraphPool.token0.id == wrappedNativeAddress &&
              subgraphPool.token1.id == tokenOutAddress) ||
            (subgraphPool.token1.id == wrappedNativeAddress &&
              subgraphPool.token0.id == tokenOutAddress)
          );
        } else {
          return (
            (subgraphPool.token0.id == wrappedNativeAddress &&
              subgraphPool.token1.id == tokenInAddress) ||
            (subgraphPool.token1.id == wrappedNativeAddress &&
              subgraphPool.token0.id == tokenInAddress)
          );
        }
      })
      .slice(0, 1)
      .value();
  }

  addToAddressSet(top2EthQuoteTokenPool);

  const topByTVL = _(subgraphPoolsSorted)
    .filter((subgraphPool) => {
      return !poolAddressesSoFar.has(subgraphPool.id);
    })
    .slice(0, topN)
    .value();

  addToAddressSet(topByTVL);

  const topByTVLUsingTokenIn = _(subgraphPoolsSorted)
    .filter((subgraphPool) => {
      return (
        !poolAddressesSoFar.has(subgraphPool.id) &&
        (subgraphPool.token0.id == tokenInAddress ||
          subgraphPool.token1.id == tokenInAddress)
      );
    })
    .slice(0, topNTokenInOut)
    .value();

  addToAddressSet(topByTVLUsingTokenIn);

  const topByTVLUsingTokenOut = _(subgraphPoolsSorted)
    .filter((subgraphPool) => {
      return (
        !poolAddressesSoFar.has(subgraphPool.id) &&
        (subgraphPool.token0.id == tokenOutAddress ||
          subgraphPool.token1.id == tokenOutAddress)
      );
    })
    .slice(0, topNTokenInOut)
    .value();

  addToAddressSet(topByTVLUsingTokenOut);

  const topByTVLUsingTokenInSecondHops = _(topByTVLUsingTokenIn)
    .map((subgraphPool) => {
      return tokenInAddress == subgraphPool.token0.id
        ? subgraphPool.token1.id
        : subgraphPool.token0.id;
    })
    .flatMap((secondHopId: string) => {
      return _(subgraphPoolsSorted)
        .filter((subgraphPool) => {
          return (
            !poolAddressesSoFar.has(subgraphPool.id) &&
            !tokensToAvoidOnSecondHops?.includes(secondHopId.toLowerCase()) &&
            (subgraphPool.token0.id == secondHopId ||
              subgraphPool.token1.id == secondHopId)
          );
        })
        .slice(
          0,
          topNSecondHopForTokenAddress?.get(secondHopId) ?? topNSecondHop
        )
        .value();
    })
    .uniqBy((pool) => pool.id)
    .value();

  addToAddressSet(topByTVLUsingTokenInSecondHops);

  const topByTVLUsingTokenOutSecondHops = _(topByTVLUsingTokenOut)
    .map((subgraphPool) => {
      return tokenOutAddress == subgraphPool.token0.id
        ? subgraphPool.token1.id
        : subgraphPool.token0.id;
    })
    .flatMap((secondHopId: string) => {
      return _(subgraphPoolsSorted)
        .filter((subgraphPool) => {
          return (
            !poolAddressesSoFar.has(subgraphPool.id) &&
            !tokensToAvoidOnSecondHops?.includes(secondHopId.toLowerCase()) &&
            (subgraphPool.token0.id == secondHopId ||
              subgraphPool.token1.id == secondHopId)
          );
        })
        .slice(
          0,
          topNSecondHopForTokenAddress?.get(secondHopId) ?? topNSecondHop
        )
        .value();
    })
    .uniqBy((pool) => pool.id)
    .value();

  addToAddressSet(topByTVLUsingTokenOutSecondHops);

  const subgraphPools = _([
    ...topByBaseWithTokenIn,
    ...topByBaseWithTokenOut,
    ...top2DirectSwapPool,
    ...top2EthQuoteTokenPool,
    ...topByTVL,
    ...topByTVLUsingTokenIn,
    ...topByTVLUsingTokenOut,
    ...topByTVLUsingTokenInSecondHops,
    ...topByTVLUsingTokenOutSecondHops,
  ])
    .compact()
    .uniqBy((pool) => pool.id)
    .value();

  const tokenAddresses = _(subgraphPools)
    .flatMap((subgraphPool) => [subgraphPool.token0.id, subgraphPool.token1.id])
    .compact()
    .uniq()
    .value();

  log.info(
    `Getting the ${tokenAddresses.length} tokens within the ${subgraphPools.length} V3 pools we are considering`
  );

  const tokenAccessor = await tokenProvider.getTokens(tokenAddresses, {
    blockNumber,
  });

  const printV3SubgraphPool = (s: V3SubgraphPool) =>
    `${tokenAccessor.getTokenByAddress(s.token0.id)?.symbol ?? s.token0.id}/${
      tokenAccessor.getTokenByAddress(s.token1.id)?.symbol ?? s.token1.id
    }/${s.feeTier}`;

  log.info(
    {
      topByBaseWithTokenIn: topByBaseWithTokenIn.map(printV3SubgraphPool),
      topByBaseWithTokenOut: topByBaseWithTokenOut.map(printV3SubgraphPool),
      topByTVL: topByTVL.map(printV3SubgraphPool),
      topByTVLUsingTokenIn: topByTVLUsingTokenIn.map(printV3SubgraphPool),
      topByTVLUsingTokenOut: topByTVLUsingTokenOut.map(printV3SubgraphPool),
      topByTVLUsingTokenInSecondHops:
        topByTVLUsingTokenInSecondHops.map(printV3SubgraphPool),
      topByTVLUsingTokenOutSecondHops:
        topByTVLUsingTokenOutSecondHops.map(printV3SubgraphPool),
      top2DirectSwap: top2DirectSwapPool.map(printV3SubgraphPool),
      top2EthQuotePool: top2EthQuoteTokenPool.map(printV3SubgraphPool),
    },
    `V3 Candidate Pools`
  );

  const tokenPairsRaw = _.map<
    V3SubgraphPool,
    [NativeToken, NativeToken, FeeAmount] | undefined
  >(subgraphPools, (subgraphPool) => {
    const tokenA = tokenAccessor.getTokenByAddress(subgraphPool.token0.id);
    const tokenB = tokenAccessor.getTokenByAddress(subgraphPool.token1.id);
    let fee: FeeAmount;
    try {
      fee = parseFeeAmount(subgraphPool.feeTier);
    } catch (err) {
      log.info(
        { subgraphPool },
        `Dropping candidate pool for ${subgraphPool.token0.id}/${subgraphPool.token1.id}/${subgraphPool.feeTier} because fee tier not supported`
      );
      return undefined;
    }

    if (!tokenA || !tokenB) {
      log.info(
        `Dropping candidate pool for ${subgraphPool.token0.id}/${
          subgraphPool.token1.id
        }/${fee} because ${
          tokenA ? subgraphPool.token1.id : subgraphPool.token0.id
        } not found by token provider`
      );
      return undefined;
    }

    return [tokenA, tokenB, fee];
  });

  const tokenPairs = _.compact(tokenPairsRaw);

  metric.putMetric(
    'V3PoolsFilterLoad',
    Date.now() - beforePoolsFiltered,
    MetricLoggerUnit.Milliseconds
  );

  const beforePoolsLoad = Date.now();

  const poolAccessor = await poolProvider.getPools(tokenPairs, {
    blockNumber,
  });

  metric.putMetric(
    'V3PoolsLoad',
    Date.now() - beforePoolsLoad,
    MetricLoggerUnit.Milliseconds
  );

  const poolsBySelection: CandidatePoolsBySelectionCriteria = {
    protocol: Protocol.V3,
    selections: {
      topByBaseWithTokenIn,
      topByBaseWithTokenOut,
      topByDirectSwapPool: top2DirectSwapPool,
      topByEthQuoteTokenPool: top2EthQuoteTokenPool,
      topByTVL,
      topByTVLUsingTokenIn,
      topByTVLUsingTokenOut,
      topByTVLUsingTokenInSecondHops,
      topByTVLUsingTokenOutSecondHops,
    },
  };

  return { poolAccessor, candidatePools: poolsBySelection, subgraphPools };
}

export type V2CandidatePools = {
  poolAccessor: V2PoolAccessor;
  candidatePools: CandidatePoolsBySelectionCriteria;
  subgraphPools: V2SubgraphPool[];
};

export async function getV2CandidatePools({
  tokenIn,
  tokenOut,
  routeType,
  routingConfig,
  subgraphProvider,
  tokenProvider,
  poolProvider,
  blockedTokenListProvider,
  chainId,
}: V2GetCandidatePoolsParams): Promise<V2CandidatePools> {
  const {
    blockNumber,
    v2PoolSelection: {
      topN,
      topNDirectSwaps,
      topNTokenInOut,
      topNSecondHop,
      tokensToAvoidOnSecondHops,
      topNWithEachBaseToken,
      topNWithBaseToken,
    },
  } = routingConfig;
  const tokenInAddress = tokenIn.address.toLowerCase();
  const tokenOutAddress = tokenOut.address.toLowerCase();

  const beforeSubgraphPools = Date.now();

  const allPoolsRaw = await subgraphProvider.getPools(tokenIn, tokenOut, {
    blockNumber,
  });

  // With tens of thousands of V2 pools, operations that copy pools become costly.
  // Mutate the pool directly rather than creating a new pool / token to optimmize for speed.
  for (const pool of allPoolsRaw) {
    pool.token0.id = pool.token0.id.toLowerCase();
    pool.token1.id = pool.token1.id.toLowerCase();
  }

  metric.putMetric(
    'V2SubgraphPoolsLoad',
    Date.now() - beforeSubgraphPools,
    MetricLoggerUnit.Milliseconds
  );

  const beforePoolsFiltered = Date.now();

  // Sort by pool reserve in descending order.
  const subgraphPoolsSorted = allPoolsRaw.sort((a, b) => b.reserve - a.reserve);

  const poolAddressesSoFar = new Set<string>();

  // Always add the direct swap pool into the mix regardless of if it exists in the subgraph pool list.
  // Ensures that new pools can be swapped on immediately, and that if a pool was filtered out of the
  // subgraph query for some reason (e.g. trackedReserveETH was 0), then we still consider it.
  let topByDirectSwapPool: V2SubgraphPool[] = [];
  if (topNDirectSwaps > 0) {
    const { token0, token1, poolAddress } = poolProvider.getPoolAddress(
      tokenIn,
      tokenOut
    );

    poolAddressesSoFar.add(poolAddress.toLowerCase());

    topByDirectSwapPool = [
      {
        id: poolAddress,
        token0: {
          id: token0.address,
        },
        token1: {
          id: token1.address,
        },
        supply: 10000, // Not used. Set to arbitrary number.
        reserve: 10000, // Not used. Set to arbitrary number.
        reserveUSD: 10000, // Not used. Set to arbitrary number.
      },
    ];
  }

  const wethAddress = WRAPPED_NATIVE_CURRENCY[chainId]!.address.toLowerCase();

  const topByBaseWithTokenInMap: Map<
    string,
    SubcategorySelectionPools<V2SubgraphPool>
  > = new Map();
  const topByBaseWithTokenOutMap: Map<
    string,
    SubcategorySelectionPools<V2SubgraphPool>
  > = new Map();

  const baseTokens = baseTokensByChain[chainId] ?? [];
  const baseTokensAddresses: Set<string> = new Set();

  baseTokens.forEach((token) => {
    const baseTokenAddr = token.address.toLowerCase();

    baseTokensAddresses.add(baseTokenAddr);
    topByBaseWithTokenInMap.set(
      baseTokenAddr,
      new SubcategorySelectionPools<V2SubgraphPool>([], topNWithEachBaseToken)
    );
    topByBaseWithTokenOutMap.set(
      baseTokenAddr,
      new SubcategorySelectionPools<V2SubgraphPool>([], topNWithEachBaseToken)
    );
  });

  let topByBaseWithTokenInPoolsFound = 0;
  let topByBaseWithTokenOutPoolsFound = 0;

  // Main reason we need this is for gas estimates
  // There can ever only be 1 NativeToken/ETH pool, so we will only look for 1
  let topNEthQuoteToken = 1;
  // but, we only need it if token out is not ETH.
  if (
    tokenOut.symbol == 'WETH' ||
    tokenOut.symbol == 'WETH9' ||
    tokenOut.symbol == 'ETH'
  ) {
    // if it's eth we change the topN to 0, so we can break early from the loop.
    topNEthQuoteToken = 0;
  }

  const topByEthQuoteTokenPool: V2SubgraphPool[] = [];
  const topByTVLUsingTokenIn: V2SubgraphPool[] = [];
  const topByTVLUsingTokenOut: V2SubgraphPool[] = [];
  const topByTVL: V2SubgraphPool[] = [];

  // Used to track how many iterations we do in the first loop
  let loopsInFirstIteration = 0;

  // Filtering step for up to first hop
  // The pools are pre-sorted, so we can just iterate through them and fill our heuristics.
  for (const subgraphPool of subgraphPoolsSorted) {
    loopsInFirstIteration += 1;
    // Check if we have satisfied all the heuristics, if so, we can stop.
    if (
      topByBaseWithTokenInPoolsFound >= topNWithBaseToken &&
      topByBaseWithTokenOutPoolsFound >= topNWithBaseToken &&
      topByEthQuoteTokenPool.length >= topNEthQuoteToken &&
      topByTVL.length >= topN &&
      topByTVLUsingTokenIn.length >= topNTokenInOut &&
      topByTVLUsingTokenOut.length >= topNTokenInOut
    ) {
      // We have satisfied all the heuristics, so we can stop.
      break;
    }

    if (poolAddressesSoFar.has(subgraphPool.id)) {
      // We've already added this pool, so skip it.
      continue;
    }

    // Only consider pools where neither tokens are in the blocked token list.
    if (blockedTokenListProvider) {
      const [token0InBlocklist, token1InBlocklist] = await Promise.all([
        blockedTokenListProvider.hasTokenByAddress(subgraphPool.token0.id),
        blockedTokenListProvider.hasTokenByAddress(subgraphPool.token1.id),
      ]);

      if (token0InBlocklist || token1InBlocklist) {
        continue;
      }
    }

    const tokenInToken0TopByBase = topByBaseWithTokenInMap.get(
      subgraphPool.token0.id
    );
    if (
      topByBaseWithTokenInPoolsFound < topNWithBaseToken &&
      tokenInToken0TopByBase &&
      subgraphPool.token0.id != tokenOutAddress &&
      subgraphPool.token1.id == tokenInAddress
    ) {
      topByBaseWithTokenInPoolsFound += 1;
      poolAddressesSoFar.add(subgraphPool.id);
      if (topByTVLUsingTokenIn.length < topNTokenInOut) {
        topByTVLUsingTokenIn.push(subgraphPool);
      }
      if (
        routeType === TradeType.EXACT_OUTPUT &&
        subgraphPool.token0.id == wethAddress
      ) {
        topByEthQuoteTokenPool.push(subgraphPool);
      }
      tokenInToken0TopByBase.pools.push(subgraphPool);
      continue;
    }

    const tokenInToken1TopByBase = topByBaseWithTokenInMap.get(
      subgraphPool.token1.id
    );
    if (
      topByBaseWithTokenInPoolsFound < topNWithBaseToken &&
      tokenInToken1TopByBase &&
      subgraphPool.token0.id == tokenInAddress &&
      subgraphPool.token1.id != tokenOutAddress
    ) {
      topByBaseWithTokenInPoolsFound += 1;
      poolAddressesSoFar.add(subgraphPool.id);
      if (topByTVLUsingTokenIn.length < topNTokenInOut) {
        topByTVLUsingTokenIn.push(subgraphPool);
      }
      if (
        routeType === TradeType.EXACT_OUTPUT &&
        subgraphPool.token1.id == wethAddress
      ) {
        topByEthQuoteTokenPool.push(subgraphPool);
      }
      tokenInToken1TopByBase.pools.push(subgraphPool);
      continue;
    }

    const tokenOutToken0TopByBase = topByBaseWithTokenOutMap.get(
      subgraphPool.token0.id
    );
    if (
      topByBaseWithTokenOutPoolsFound < topNWithBaseToken &&
      tokenOutToken0TopByBase &&
      subgraphPool.token0.id != tokenInAddress &&
      subgraphPool.token1.id == tokenOutAddress
    ) {
      topByBaseWithTokenOutPoolsFound += 1;
      poolAddressesSoFar.add(subgraphPool.id);
      if (topByTVLUsingTokenOut.length < topNTokenInOut) {
        topByTVLUsingTokenOut.push(subgraphPool);
      }
      if (
        routeType === TradeType.EXACT_INPUT &&
        subgraphPool.token0.id == wethAddress
      ) {
        topByEthQuoteTokenPool.push(subgraphPool);
      }
      tokenOutToken0TopByBase.pools.push(subgraphPool);
      continue;
    }

    const tokenOutToken1TopByBase = topByBaseWithTokenOutMap.get(
      subgraphPool.token1.id
    );
    if (
      topByBaseWithTokenOutPoolsFound < topNWithBaseToken &&
      tokenOutToken1TopByBase &&
      subgraphPool.token0.id == tokenOutAddress &&
      subgraphPool.token1.id != tokenInAddress
    ) {
      topByBaseWithTokenOutPoolsFound += 1;
      poolAddressesSoFar.add(subgraphPool.id);
      if (topByTVLUsingTokenOut.length < topNTokenInOut) {
        topByTVLUsingTokenOut.push(subgraphPool);
      }
      if (
        routeType === TradeType.EXACT_INPUT &&
        subgraphPool.token1.id == wethAddress
      ) {
        topByEthQuoteTokenPool.push(subgraphPool);
      }
      tokenOutToken1TopByBase.pools.push(subgraphPool);
      continue;
    }

    // Note: we do not need to check other native currencies for the V2 Protocol
    if (
      topByEthQuoteTokenPool.length < topNEthQuoteToken &&
      ((routeType === TradeType.EXACT_INPUT &&
        ((subgraphPool.token0.id == wethAddress &&
          subgraphPool.token1.id == tokenOutAddress) ||
          (subgraphPool.token1.id == wethAddress &&
            subgraphPool.token0.id == tokenOutAddress))) ||
        (routeType === TradeType.EXACT_OUTPUT &&
          ((subgraphPool.token0.id == wethAddress &&
            subgraphPool.token1.id == tokenInAddress) ||
            (subgraphPool.token1.id == wethAddress &&
              subgraphPool.token0.id == tokenInAddress))))
    ) {
      poolAddressesSoFar.add(subgraphPool.id);
      topByEthQuoteTokenPool.push(subgraphPool);
      continue;
    }

    if (topByTVL.length < topN) {
      poolAddressesSoFar.add(subgraphPool.id);
      topByTVL.push(subgraphPool);
      continue;
    }

    if (
      topByTVLUsingTokenIn.length < topNTokenInOut &&
      (subgraphPool.token0.id == tokenInAddress ||
        subgraphPool.token1.id == tokenInAddress)
    ) {
      poolAddressesSoFar.add(subgraphPool.id);
      topByTVLUsingTokenIn.push(subgraphPool);
      continue;
    }

    if (
      topByTVLUsingTokenOut.length < topNTokenInOut &&
      (subgraphPool.token0.id == tokenOutAddress ||
        subgraphPool.token1.id == tokenOutAddress)
    ) {
      poolAddressesSoFar.add(subgraphPool.id);
      topByTVLUsingTokenOut.push(subgraphPool);
      continue;
    }
  }

  metric.putMetric(
    'V2SubgraphLoopsInFirstIteration',
    loopsInFirstIteration,
    MetricLoggerUnit.Count
  );

  const topByBaseWithTokenIn: V2SubgraphPool[] = [];
  for (const topByBaseWithTokenInSelection of topByBaseWithTokenInMap.values()) {
    topByBaseWithTokenIn.push(...topByBaseWithTokenInSelection.pools);
  }

  const topByBaseWithTokenOut: V2SubgraphPool[] = [];
  for (const topByBaseWithTokenOutSelection of topByBaseWithTokenOutMap.values()) {
    topByBaseWithTokenOut.push(...topByBaseWithTokenOutSelection.pools);
  }

  // Filtering step for second hops
  const topByTVLUsingTokenInSecondHopsMap: Map<
    string,
    SubcategorySelectionPools<V2SubgraphPool>
  > = new Map();
  const topByTVLUsingTokenOutSecondHopsMap: Map<
    string,
    SubcategorySelectionPools<V2SubgraphPool>
  > = new Map();
  const tokenInSecondHopAddresses = topByTVLUsingTokenIn
    .filter((pool) => {
      // filtering second hops
      if (tokenInAddress === pool.token0.id) {
        return !tokensToAvoidOnSecondHops?.includes(
          pool.token1.id.toLowerCase()
        );
      } else {
        return !tokensToAvoidOnSecondHops?.includes(
          pool.token0.id.toLowerCase()
        );
      }
    })
    .map((pool) =>
      tokenInAddress === pool.token0.id ? pool.token1.id : pool.token0.id
    );
  const tokenOutSecondHopAddresses = topByTVLUsingTokenOut
    .filter((pool) => {
      // filtering second hops
      if (tokenOutAddress === pool.token0.id) {
        return !tokensToAvoidOnSecondHops?.includes(
          pool.token1.id.toLowerCase()
        );
      } else {
        return !tokensToAvoidOnSecondHops?.includes(
          pool.token0.id.toLowerCase()
        );
      }
    })
    .map((pool) =>
      tokenOutAddress === pool.token0.id ? pool.token1.id : pool.token0.id
    );

  for (const secondHopId of tokenInSecondHopAddresses) {
    topByTVLUsingTokenInSecondHopsMap.set(
      secondHopId,
      new SubcategorySelectionPools<V2SubgraphPool>([], topNSecondHop)
    );
  }
  for (const secondHopId of tokenOutSecondHopAddresses) {
    topByTVLUsingTokenOutSecondHopsMap.set(
      secondHopId,
      new SubcategorySelectionPools<V2SubgraphPool>([], topNSecondHop)
    );
  }

  // Used to track how many iterations we do in the second loop
  let loopsInSecondIteration = 0;

  if (
    tokenInSecondHopAddresses.length > 0 ||
    tokenOutSecondHopAddresses.length > 0
  ) {
    for (const subgraphPool of subgraphPoolsSorted) {
      loopsInSecondIteration += 1;

      let allTokenInSecondHopsHaveTheirTopN = true;
      for (const secondHopPools of topByTVLUsingTokenInSecondHopsMap.values()) {
        if (!secondHopPools.hasEnoughPools()) {
          allTokenInSecondHopsHaveTheirTopN = false;
          break;
        }
      }

      let allTokenOutSecondHopsHaveTheirTopN = true;
      for (const secondHopPools of topByTVLUsingTokenOutSecondHopsMap.values()) {
        if (!secondHopPools.hasEnoughPools()) {
          allTokenOutSecondHopsHaveTheirTopN = false;
          break;
        }
      }

      if (
        allTokenInSecondHopsHaveTheirTopN &&
        allTokenOutSecondHopsHaveTheirTopN
      ) {
        // We have satisfied all the heuristics, so we can stop.
        break;
      }

      if (poolAddressesSoFar.has(subgraphPool.id)) {
        continue;
      }

      // Only consider pools where neither tokens are in the blocked token list.
      if (blockedTokenListProvider) {
        const [token0InBlocklist, token1InBlocklist] = await Promise.all([
          blockedTokenListProvider.hasTokenByAddress(subgraphPool.token0.id),
          blockedTokenListProvider.hasTokenByAddress(subgraphPool.token1.id),
        ]);

        if (token0InBlocklist || token1InBlocklist) {
          continue;
        }
      }

      const tokenInToken0SecondHop = topByTVLUsingTokenInSecondHopsMap.get(
        subgraphPool.token0.id
      );

      if (tokenInToken0SecondHop && !tokenInToken0SecondHop.hasEnoughPools()) {
        poolAddressesSoFar.add(subgraphPool.id);
        tokenInToken0SecondHop.pools.push(subgraphPool);
        continue;
      }

      const tokenInToken1SecondHop = topByTVLUsingTokenInSecondHopsMap.get(
        subgraphPool.token1.id
      );

      if (tokenInToken1SecondHop && !tokenInToken1SecondHop.hasEnoughPools()) {
        poolAddressesSoFar.add(subgraphPool.id);
        tokenInToken1SecondHop.pools.push(subgraphPool);
        continue;
      }

      const tokenOutToken0SecondHop = topByTVLUsingTokenOutSecondHopsMap.get(
        subgraphPool.token0.id
      );

      if (
        tokenOutToken0SecondHop &&
        !tokenOutToken0SecondHop.hasEnoughPools()
      ) {
        poolAddressesSoFar.add(subgraphPool.id);
        tokenOutToken0SecondHop.pools.push(subgraphPool);
        continue;
      }

      const tokenOutToken1SecondHop = topByTVLUsingTokenOutSecondHopsMap.get(
        subgraphPool.token1.id
      );

      if (
        tokenOutToken1SecondHop &&
        !tokenOutToken1SecondHop.hasEnoughPools()
      ) {
        poolAddressesSoFar.add(subgraphPool.id);
        tokenOutToken1SecondHop.pools.push(subgraphPool);
        continue;
      }
    }
  }

  metric.putMetric(
    'V2SubgraphLoopsInSecondIteration',
    loopsInSecondIteration,
    MetricLoggerUnit.Count
  );

  const topByTVLUsingTokenInSecondHops: V2SubgraphPool[] = [];
  for (const secondHopPools of topByTVLUsingTokenInSecondHopsMap.values()) {
    topByTVLUsingTokenInSecondHops.push(...secondHopPools.pools);
  }

  const topByTVLUsingTokenOutSecondHops: V2SubgraphPool[] = [];
  for (const secondHopPools of topByTVLUsingTokenOutSecondHopsMap.values()) {
    topByTVLUsingTokenOutSecondHops.push(...secondHopPools.pools);
  }

  const subgraphPools = _([
    ...topByBaseWithTokenIn,
    ...topByBaseWithTokenOut,
    ...topByDirectSwapPool,
    ...topByEthQuoteTokenPool,
    ...topByTVL,
    ...topByTVLUsingTokenIn,
    ...topByTVLUsingTokenOut,
    ...topByTVLUsingTokenInSecondHops,
    ...topByTVLUsingTokenOutSecondHops,
  ])
    .uniqBy((pool) => pool.id)
    .value();

  const tokenAddressesSet: Set<string> = new Set();
  for (const pool of subgraphPools) {
    tokenAddressesSet.add(pool.token0.id);
    tokenAddressesSet.add(pool.token1.id);
  }
  const tokenAddresses = Array.from(tokenAddressesSet);

  log.info(
    `Getting the ${tokenAddresses.length} tokens within the ${subgraphPools.length} V2 pools we are considering`
  );

  const tokenAccessor = await tokenProvider.getTokens(tokenAddresses, {
    blockNumber,
  });

  const printV2SubgraphPool = (s: V2SubgraphPool) =>
    `${tokenAccessor.getTokenByAddress(s.token0.id)?.symbol ?? s.token0.id}/${
      tokenAccessor.getTokenByAddress(s.token1.id)?.symbol ?? s.token1.id
    }`;

  log.info(
    {
      topByBaseWithTokenIn: topByBaseWithTokenIn.map(printV2SubgraphPool),
      topByBaseWithTokenOut: topByBaseWithTokenOut.map(printV2SubgraphPool),
      topByTVL: topByTVL.map(printV2SubgraphPool),
      topByTVLUsingTokenIn: topByTVLUsingTokenIn.map(printV2SubgraphPool),
      topByTVLUsingTokenOut: topByTVLUsingTokenOut.map(printV2SubgraphPool),
      topByTVLUsingTokenInSecondHops:
        topByTVLUsingTokenInSecondHops.map(printV2SubgraphPool),
      topByTVLUsingTokenOutSecondHops:
        topByTVLUsingTokenOutSecondHops.map(printV2SubgraphPool),
      top2DirectSwap: topByDirectSwapPool.map(printV2SubgraphPool),
      top2EthQuotePool: topByEthQuoteTokenPool.map(printV2SubgraphPool),
    },
    `V2 Candidate pools`
  );

  const tokenPairsRaw = _.map<
    V2SubgraphPool,
    [NativeToken, NativeToken] | undefined
  >(subgraphPools, (subgraphPool) => {
    const tokenA = tokenAccessor.getTokenByAddress(subgraphPool.token0.id);
    const tokenB = tokenAccessor.getTokenByAddress(subgraphPool.token1.id);

    if (!tokenA || !tokenB) {
      log.info(
        `Dropping candidate pool for ${subgraphPool.token0.id}/${subgraphPool.token1.id}`
      );
      return undefined;
    }

    return [tokenA, tokenB];
  });

  const tokenPairs = _.compact(tokenPairsRaw);

  metric.putMetric(
    'V2PoolsFilterLoad',
    Date.now() - beforePoolsFiltered,
    MetricLoggerUnit.Milliseconds
  );

  const beforePoolsLoad = Date.now();

  // this should be the only place to enable fee-on-transfer fee fetching,
  // because this places loads pools (pairs of tokens with fot taxes) from the subgraph
  const poolAccessor = await poolProvider.getPools(tokenPairs, routingConfig);

  metric.putMetric(
    'V2PoolsLoad',
    Date.now() - beforePoolsLoad,
    MetricLoggerUnit.Milliseconds
  );

  const poolsBySelection: CandidatePoolsBySelectionCriteria = {
    protocol: Protocol.V2,
    selections: {
      topByBaseWithTokenIn,
      topByBaseWithTokenOut,
      topByDirectSwapPool,
      topByEthQuoteTokenPool,
      topByTVL,
      topByTVLUsingTokenIn,
      topByTVLUsingTokenOut,
      topByTVLUsingTokenInSecondHops,
      topByTVLUsingTokenOutSecondHops,
    },
  };

  return { poolAccessor, candidatePools: poolsBySelection, subgraphPools };
}

export type MixedCandidatePools = {
  StablePoolAccessor: StablePoolAccessor;
  V3poolAccessor: V3PoolAccessor;
  candidatePools: CandidatePoolsBySelectionCriteria;
  subgraphPools: (V2SubgraphPool | V3SubgraphPool | StableSubgraphPool)[];
};

export async function getMixedRouteCandidatePools({
  stableCandidatePools,
  v3CandidatePools,
  routingConfig,
  tokenProvider,
  stablePoolProvider,
  v3poolProvider,
}: MixedRouteGetCandidatePoolsParams): Promise<MixedCandidatePools> {
  const beforeSubgraphPools = Date.now();
  const [
    { subgraphPools: V3subgraphPools, candidatePools: V3candidatePools },
    {
      subgraphPools: StablesubgraphPools,
      candidatePools: StablecandidatePools,
    },
  ] = [v3CandidatePools, stableCandidatePools];

  metric.putMetric(
    'MixedSubgraphPoolsLoad',
    Date.now() - beforeSubgraphPools,
    MetricLoggerUnit.Milliseconds
  );
  const beforePoolsFiltered = Date.now();

  // TODO: Add an heurisitc here to filter out pools that are not relevant to the trade

  const StablesortedPools = _(StablesubgraphPools)
    .sortBy((pool) => -pool.tvlUSD)
    .value();

  /// we consider all returned V3 pools for this heuristic to "fill in the gaps"
  const V3sortedPools = _(V3subgraphPools)
    .sortBy((pool) => -pool.tvlUSD)
    .value();

  const subgraphPools = [...V3sortedPools, ...StablesortedPools];

  const tokenAddresses = _(subgraphPools)
    .flatMap((subgraphPool) =>
      'tokensList' in subgraphPool
        ? [...subgraphPool.tokensList, subgraphPool.wrapper]
        : [subgraphPool.token0.id, subgraphPool.token1.id]
    )
    .compact()
    .uniq()
    .value();

  log.info(
    `Getting the ${tokenAddresses.length} tokens within the ${subgraphPools.length} pools we are considering`
  );

  const tokenAccessor = await tokenProvider.getTokens(
    tokenAddresses,
    routingConfig
  );

  const V3tokenPairsRaw = _.map<
    V3SubgraphPool,
    [NativeToken, NativeToken, FeeAmount] | undefined
  >(V3sortedPools, (subgraphPool) => {
    const tokenA = tokenAccessor.getTokenByAddress(subgraphPool.token0.id);
    const tokenB = tokenAccessor.getTokenByAddress(subgraphPool.token1.id);
    let fee: FeeAmount;
    try {
      fee = parseFeeAmount(subgraphPool.feeTier);
    } catch (err) {
      log.info(
        { subgraphPool },
        `Dropping candidate pool for ${subgraphPool.token0.id}/${subgraphPool.token1.id}/${subgraphPool.feeTier} because fee tier not supported`
      );
      return undefined;
    }

    if (!tokenA || !tokenB) {
      log.info(
        `Dropping candidate pool for ${subgraphPool.token0.id}/${
          subgraphPool.token1.id
        }/${fee} because ${
          tokenA ? subgraphPool.token1.id : subgraphPool.token0.id
        } not found by token provider`
      );
      return undefined;
    }

    return [tokenA, tokenB, fee];
  });

  const V3tokenPairs = _.compact(V3tokenPairsRaw);

  const StableTokenPairsRaw = _.map<
    StableSubgraphPool,
    [string, NativeToken[], NativeToken?] | undefined
  >(StablesortedPools, (subgraphPool) => {
    const tokens = subgraphPool.tokensList.map((token) =>
      tokenAccessor.getTokenByAddress(token)
    );
    const wrapper = subgraphPool.wrapper
      ? tokenAccessor.getTokenByAddress(subgraphPool.wrapper)
      : undefined;

    // Check if any token is undefined
    if (tokens.some((token) => token === undefined)) {
      const missingTokenId = subgraphPool.tokensList!.find(
        (token) => tokenAccessor.getTokenByAddress(token) === undefined
      );
      log.info(
        `Dropping candidate pool for ${subgraphPool.id} because token ${missingTokenId} not found by token provider`
      );
      return undefined;
    }

    return [subgraphPool.id, tokens as NativeToken[], wrapper];
  });

  const StableTokenPairs = _.compact(StableTokenPairsRaw);

  metric.putMetric(
    'MixedPoolsFilterLoad',
    Date.now() - beforePoolsFiltered,
    MetricLoggerUnit.Milliseconds
  );

  const beforePoolsLoad = Date.now();

  const [StablePoolAccessor, V3poolAccessor] = await Promise.all([
    stablePoolProvider.getPools(StableTokenPairs, routingConfig),
    v3poolProvider.getPools(V3tokenPairs, routingConfig),
  ]);

  metric.putMetric(
    'MixedPoolsLoad',
    Date.now() - beforePoolsLoad,
    MetricLoggerUnit.Milliseconds
  );

  const buildPoolsBySelection = (key: keyof CandidatePoolsSelections) => {
    return [
      ...V3candidatePools.selections[key],
      ...StablecandidatePools.selections[key],
    ];
  };

  const poolsBySelection: CandidatePoolsBySelectionCriteria = {
    protocol: Protocol.MIXED,
    selections: {
      topByBaseWithTokenIn: buildPoolsBySelection('topByBaseWithTokenIn'),
      topByBaseWithTokenOut: buildPoolsBySelection('topByBaseWithTokenOut'),
      topByDirectSwapPool: buildPoolsBySelection('topByDirectSwapPool'),
      topByEthQuoteTokenPool: buildPoolsBySelection('topByEthQuoteTokenPool'),
      topByTVL: buildPoolsBySelection('topByTVL'),
      topByTVLUsingTokenIn: buildPoolsBySelection('topByTVLUsingTokenIn'),
      topByTVLUsingTokenOut: buildPoolsBySelection('topByTVLUsingTokenOut'),
      topByTVLUsingTokenInSecondHops: buildPoolsBySelection(
        'topByTVLUsingTokenInSecondHops'
      ),
      topByTVLUsingTokenOutSecondHops: buildPoolsBySelection(
        'topByTVLUsingTokenOutSecondHops'
      ),
    },
  };

  return {
    StablePoolAccessor,
    V3poolAccessor,
    candidatePools: poolsBySelection,
    subgraphPools,
  };
}

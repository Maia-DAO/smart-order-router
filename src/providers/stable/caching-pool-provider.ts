import { ComposableStablePool } from 'hermes-v2-sdk';
import _ from 'lodash';
import { ChainId, NativeToken } from 'maia-core-sdk';

import { metric, MetricLoggerUnit } from '../../util';
import { log } from '../../util/log';

import { ICache } from './../cache';
import { ProviderConfig } from './../provider';
import { IStablePoolProvider, StablePoolAccessor } from './pool-provider';

/**
 * Provider for getting Stable pools, with functionality for caching the results.
 * Does not cache by block because we compute quotes using the on-chain quoter
 * so do not mind if the liquidity values are out of date.
 *
 * @export
 * @class CachingStablePoolProvider
 */
export class CachingStablePoolProvider implements IStablePoolProvider {
  private POOL_KEY = (chainId: ChainId, poolId: string, blockNumber?: number) =>
    blockNumber
      ? `pool-${chainId}-${poolId}-${blockNumber}`
      : `pool-${chainId}-${poolId}`;

  /**
   * Creates an instance of CachingStablePoolProvider.
   * @param chainId The chain id to use.
   * @param poolProvider The provider to use to get the pools when not in the cache.
   * @param cache Cache instance to hold cached pools.
   */
  constructor(
    protected chainId: ChainId,
    protected poolProvider: IStablePoolProvider,
    private cache: ICache<ComposableStablePool>
  ) {}

  public async getPools(
    poolInfo: [string, NativeToken[], NativeToken?][],
    providerConfig?: ProviderConfig
  ): Promise<StablePoolAccessor> {
    const poolIdSet: Set<string> = new Set<string>();
    const poolIdsToGetTokenPairs: Array<[string, NativeToken[], NativeToken?]> =
      [];
    const poolIdAndTokensToPool: { [key: string]: ComposableStablePool } = {};

    const blockNumber = await providerConfig?.blockNumber;

    for (const [poolId, tokens, wrapper] of poolInfo) {
      if (poolIdSet.has(poolId)) {
        continue;
      }

      poolIdSet.add(poolId);

      let shouldContinue = true; // Flag to indicate when to break out of both loops or not

      // Get all unique pairs
      for (let i = 0; i < tokens.length && shouldContinue; i++) {
        const tokenA = tokens[i]!;
        for (let j = i + 1; j <= tokens.length; j++) {
          const tokenB = j < tokens.length ? tokens[j] : wrapper;
          if (!tokenB) continue;

          const { key } = this.getPoolKey(tokenA, tokenB, poolId);

          const cachedPool = await this.cache.get(
            this.POOL_KEY(this.chainId, key, blockNumber)
          );
          if (!cachedPool) {
            metric.putMetric(
              'STABLE_INMEMORY_CACHING_POOL_MISS_NOT_IN_MEMORY',
              1,
              MetricLoggerUnit.None
            );

            // If a path is not stored, update all paths that use this pool
            poolIdsToGetTokenPairs.push([poolId, tokens, wrapper]);
            // Break both loops if cachedPool is not found
            shouldContinue = false;
            break;
          }

          metric.putMetric(
            'STABLE_INMEMORY_CACHING_POOL_HIT_IN_MEMORY',
            1,
            MetricLoggerUnit.None
          );
          poolIdAndTokensToPool[key] = cachedPool;
        }
      }
    }

    log.info(
      {
        poolsFound: _.map(
          Object.values(poolIdAndTokensToPool),
          (p) => `${p.token0.symbol} ${p.token1.symbol} ${p.pool.id}`
        ),
        poolIdsToGetTokenPairs: _.map(poolIdsToGetTokenPairs, (t) => `${t}`),
      },
      `Found ${
        Object.keys(poolIdAndTokensToPool).length
      } Stable pools already in local cache. About to get info for ${
        poolIdsToGetTokenPairs.length
      } pools.`
    );

    if (poolIdsToGetTokenPairs.length > 0) {
      const poolAccessor = await this.poolProvider.getPools(
        poolIdsToGetTokenPairs,
        providerConfig
      );
      for (const [poolId, tokens, wrapper] of poolIdsToGetTokenPairs) {
        // Get all unique pairs
        for (let i = 0; i < tokens.length; i++) {
          const tokenA = tokens[i]!;
          for (let j = i + 1; j <= tokens.length; j++) {
            const tokenB = j < tokens.length ? tokens[j] : wrapper;
            if (!tokenB) continue;

            const { key } = this.getPoolKey(tokenA, tokenB, poolId);

            const pool = poolAccessor.getPoolByKey(key);
            if (pool) {
              poolIdAndTokensToPool[key] = pool;
              // We don't want to wait for this caching to complete before returning the pools.
              this.cache.set(
                this.POOL_KEY(this.chainId, key, blockNumber),
                pool
              );
            }
          }
        }
      }
    }

    return {
      getPool: (
        tokenA: NativeToken,
        tokenB: NativeToken,
        poolId: string
      ): ComposableStablePool | undefined => {
        const { key } = this.getPoolKey(tokenA, tokenB, poolId);
        return poolIdAndTokensToPool[key];
      },
      getPoolByKey: (key: string): ComposableStablePool | undefined =>
        poolIdAndTokensToPool[key],
      getAllPools: (): ComposableStablePool[] =>
        Object.values(poolIdAndTokensToPool),
    };
  }

  public getPoolKey(
    tokenA: NativeToken,
    tokenB: NativeToken,
    poolId: string
  ): { key: string } {
    return this.poolProvider.getPoolKey(tokenA, tokenB, poolId);
  }
}

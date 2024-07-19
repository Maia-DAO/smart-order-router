import { ChainId } from 'maia-core-sdk';

import { ICache } from './../cache';
import {
  IStableSubgraphProvider,
  StableSubgraphPool,
} from './subgraph-provider';

/**
 * Provider for getting Stable pools, with functionality for caching the results.
 *
 * @export
 * @class CachingStableSubgraphProvider
 */
export class CachingStableSubgraphProvider implements IStableSubgraphProvider {
  private SUBGRAPH_KEY = (chainId: ChainId) => `subgraph-pools-${chainId}`;

  /**
   * Creates an instance of CachingStableSubgraphProvider.
   * @param chainId The chain id to use.
   * @param subgraphProvider The provider to use to get the subgraph pools when not in the cache.
   * @param cache Cache instance to hold cached pools.
   */
  constructor(
    private chainId: ChainId,
    protected subgraphProvider: IStableSubgraphProvider,
    private cache: ICache<StableSubgraphPool[]>
  ) {}

  public async getPools(): Promise<StableSubgraphPool[]> {
    const cachedPools = await this.cache.get(this.SUBGRAPH_KEY(this.chainId));

    if (cachedPools) {
      return cachedPools;
    }

    const pools = await this.subgraphProvider.getPools();

    await this.cache.set(this.SUBGRAPH_KEY(this.chainId), pools);

    return pools;
  }
}

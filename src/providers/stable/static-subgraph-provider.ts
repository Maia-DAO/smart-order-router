/* eslint-disable @typescript-eslint/no-non-null-assertion */
import _ from 'lodash';
import { NativeToken } from 'maia-core-sdk';
import { ChainId } from 'maia-core-sdk';

import { log } from '../../util/log';
import { ProviderConfig } from '../provider';

import { IStablePoolProvider } from './pool-provider';
import {
  IStableSubgraphProvider,
  StableSubgraphPool,
} from './subgraph-provider';

type ChainPoolIdAndTokenList = {
  readonly [chainId in ChainId]: [string, NativeToken[]][];
};

// Stable Pools can have multiple pools for the same tokens list and fee tier.
// So we have a list of poolIds to check against.
const POOL_IDS_TO_CHECK_TRADES: ChainPoolIdAndTokenList = {
  // TODO: Add poolIds here, for now return empty array
  [ChainId.MAINNET]: [],
  [ChainId.SEPOLIA]: [],
  [ChainId.OPTIMISM]: [],
  [ChainId.ARBITRUM_ONE]: [],
};

/**
 * Provider that uses a hardcoded list of Stable pools to generate a list of subgraph pools.
 *
 * Since the pools are hardcoded and the data does not come from the Subgraph, the TVL values
 * are dummys and should not be depended on.
 *
 * Useful for instances where other data sources are unavailable. E.g. Subgraph not available.
 *
 * @export
 * @class StaticStableSubgraphProvider
 */
export class StaticStableSubgraphProvider implements IStableSubgraphProvider {
  constructor(
    private chainId: ChainId,
    private poolProvider: IStablePoolProvider
  ) {}

  public async getPools(
    _tokenIn?: NativeToken,
    _tokenOut?: NativeToken,
    providerConfig?: ProviderConfig
  ): Promise<StableSubgraphPool[]> {
    log.info('In static subgraph provider for Stable');
    const stablePools = POOL_IDS_TO_CHECK_TRADES[this.chainId];

    log.info(
      `Stable Static subgraph provider about to get ${stablePools.length} pools on-chain`
    );

    const poolAccessor = await this.poolProvider.getPools(
      stablePools,
      providerConfig
    );
    const pools = poolAccessor.getAllPools();

    const poolAddressSet = new Set<string>();
    const subgraphPools: StableSubgraphPool[] = _(pools)
      .map((pool) => {
        const poolId = pool.pool.id.toLowerCase();

        if (poolAddressSet.has(poolId)) {
          return undefined;
        }
        poolAddressSet.add(poolId);

        const totalSharesNumber = pool.pool.totalShares.toNumber();

        return {
          id: poolId,
          totalShares: pool.pool.totalShares.toString(),
          tokensList: pool.pool.tokensList,

          // As a very rough proxy we just use totalShares for TVL.
          tvlETH: totalSharesNumber,
          tvlUSD: totalSharesNumber,
        };
      })
      .compact()
      .value();

    return subgraphPools;
  }
}

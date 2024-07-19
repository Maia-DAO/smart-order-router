import retry from 'async-retry';
import Timeout from 'await-timeout';
import { gql, GraphQLClient } from 'graphql-request';
import _ from 'lodash';
import { ChainId, NativeToken } from 'maia-core-sdk';

import { computeVaultAddress, VAULT_FACTORY_ADDRESS } from 'hermes-v2-sdk';
import { log } from '../../util';
import { ProviderConfig } from '../provider';

export interface StableSubgraphPool {
  id: string;
  totalShares: string;
  tokensList: string[];
  wrapper?: string;

  // As a very rough proxy we just use totalShares for TVL.
  tvlETH: number;
  tvlUSD: number;
}

type RawStableSubgraphPool = {
  id: string;
  totalShares: string;
  tokensList: string[];
};

export const printStableSubgraphPool = (s: StableSubgraphPool) => `${s.id}`;

const BALANCER_SUBGRAPH_URL_BY_CHAIN: { [chainId in ChainId]?: string } = {
  [ChainId.MAINNET]:
    'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-v2',
  [ChainId.SEPOLIA]:
    'https://api.studio.thegraph.com/query/24660/balancer-sepolia-v2/version/latest',
  [ChainId.OPTIMISM]:
    'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-optimism-v2',
  [ChainId.ARBITRUM_ONE]:
    'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-arbitrum-v2',
};

const PAGE_SIZE = 1000; // 1k is max possible query size from subgraph.

/**
 * Provider for getting Stable pools from the Subgraph
 *
 * @export
 * @interface IStableSubgraphProvider
 */
export interface IStableSubgraphProvider {
  getPools(
    tokenIn?: NativeToken,
    tokenOut?: NativeToken,
    providerConfig?: ProviderConfig
  ): Promise<StableSubgraphPool[]>;
}

export class StableSubgraphProvider implements IStableSubgraphProvider {
  private client: GraphQLClient;

  constructor(
    private chainId: ChainId,
    private retries = 2,
    private timeout = 30000,
    private rollback = true
  ) {
    const subgraphUrl = BALANCER_SUBGRAPH_URL_BY_CHAIN[this.chainId];
    if (!subgraphUrl) {
      throw new Error(`No subgraph url for chain id: ${this.chainId}`);
    }
    this.client = new GraphQLClient(subgraphUrl);
  }

  public async getPools(
    _tokenIn?: NativeToken,
    _tokenOut?: NativeToken,
    providerConfig?: ProviderConfig
  ): Promise<StableSubgraphPool[]> {
    let blockNumber = providerConfig?.blockNumber
      ? await providerConfig.blockNumber
      : undefined;

    // TODO: Add queries to pool TVL values to improve pool sorting. For example add:
    // historicalValues(first: 1) {
    //   poolShareValue
    //   pricingAsset
    // }
    const query = gql`
      query getPools($pageSize: Int!, $id: String) {
        pools(
          first: $pageSize
          ${blockNumber ? `block: { number: ${blockNumber} }` : ``}
          where: { id_gt: $id, poolType: "ComposableStable", poolTypeVersion: 5 }
        ) {
          id
          totalShares
          tokensList
        }
      }
    `;

    let pools: RawStableSubgraphPool[] = [];

    log.info(
      `Getting Stable pools from the subgraph with page size ${PAGE_SIZE}${
        providerConfig?.blockNumber
          ? ` as of block ${providerConfig?.blockNumber}`
          : ''
      }.`
    );

    await retry(
      async () => {
        const timeout = new Timeout();

        const getPools = async (): Promise<RawStableSubgraphPool[]> => {
          let lastId = '';
          let pools: RawStableSubgraphPool[] = [];
          let poolsPage: RawStableSubgraphPool[] = [];

          do {
            const poolsResult = await this.client.request<{
              pools: RawStableSubgraphPool[];
            }>(query, {
              pageSize: PAGE_SIZE,
              id: lastId,
            });

            poolsPage = poolsResult.pools;

            pools = pools.concat(poolsPage);

            lastId = pools[pools.length - 1]!.id;
          } while (poolsPage.length > 0);

          return pools;
        };

        /* eslint-disable no-useless-catch */
        try {
          const getPoolsPromise = getPools();
          const timerPromise = timeout.set(this.timeout).then(() => {
            throw new Error(
              `Timed out getting pools from subgraph: ${this.timeout}`
            );
          });
          pools = await Promise.race([getPoolsPromise, timerPromise]);
          return;
        } catch (err) {
          throw err;
        } finally {
          timeout.clear();
        }
        /* eslint-enable no-useless-catch */
      },
      {
        retries: this.retries,
        onRetry: (err, retry) => {
          if (
            this.rollback &&
            blockNumber &&
            _.includes(err.message, 'indexed up to')
          ) {
            blockNumber = blockNumber - 10;
            log.info(
              `Detected subgraph indexing error. Rolled back block number to: ${blockNumber}`
            );
          }
          pools = [];
          log.info(
            { err },
            `Failed to get pools from subgraph. Retry attempt: ${retry}`
          );
        },
      }
    );

    const poolsSanitized = pools
      .filter(
        (pool) => parseInt(pool.totalShares) > 0
        // TODO: Filter pools with low tvl
        // || parseFloat(pool.totalValueLockedETH) > 0.01
      )
      .map((pool) => {
        const totalSharesNumber = Number(pool.totalShares);
        const wrapper = computeVaultAddress({
          factoryAddress: VAULT_FACTORY_ADDRESS,
          underlying: pool.id.substring(0, 42),
        });

        return {
          id: pool.id.toLowerCase(),
          totalShares: pool.totalShares,
          tokensList: pool.tokensList,
          wrapper: wrapper,

          // As a very rough proxy we just use totalShares for TVL.
          tvlETH: totalSharesNumber,
          tvlUSD: totalSharesNumber,
        };
      });

    log.info(
      `Got ${pools.length} Stable pools from the subgraph. ${poolsSanitized.length} after filtering`
    );

    return poolsSanitized;
  }
}

import retry from 'async-retry';
import Timeout from 'await-timeout';
import { gql, GraphQLClient } from 'graphql-request';
import _ from 'lodash';
import { BalancerAddresses, ChainId, NativeToken } from 'maia-core-sdk';

import { computeVaultAddress } from 'hermes-v2-sdk';
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

// TODO: Check if using production subgraph is needed: https://docs.balancer.fi/reference/subgraph/#v2-subgraphs
const BALANCER_SUBGRAPH_URL_BY_CHAIN: { [chainId in ChainId]?: string } = {
  [ChainId.MAINNET]:
    // 'https://api.studio.thegraph.com/query/75376/balancer-v2/version/latest',
    '',
  [ChainId.SEPOLIA]:
    'https://api.studio.thegraph.com/query/24660/balancer-sepolia-v2/version/latest',
  [ChainId.OPTIMISM]:
    // 'https://api.studio.thegraph.com/query/75376/balancer-optimism-v2/version/latest',
    '',
  [ChainId.ARBITRUM_ONE]:
    // 'https://api.studio.thegraph.com/query/75376/balancer-arbitrum-v2/version/latest',
    'https://gateway-arbitrum.network.thegraph.com/api/0ae45f0bf40ae2e73119b44ccd755967/subgraphs/id/98cQDy6tufTJtshDCuhh9z2kWXsQWBHVh2bqnLHsGAeS',
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
  private factoryAddress: string;
  private initCodeHash: string;

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
    const _factoryAddress =
      BalancerAddresses[this.chainId]?.ComposableStablePoolWrapperFactory;
    const _initCodeHash =
      BalancerAddresses[this.chainId]?.ComposableStablePoolWrapperInitCodeHash;
    if (!_factoryAddress || !_initCodeHash) {
      throw new Error(
        `No factory address or init code hash for chain id: ${this.chainId}`
      );
    }

    this.factoryAddress = _factoryAddress;
    this.initCodeHash = _initCodeHash;
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
          where: { id_gt: $id, poolType: "ComposableStable", poolTypeVersion_in: [5, 6] }
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
      .filter((pool) => {
        // TODO: Filter pools with low tvl
        // if (parseFloat(pool.totalValueLockedETH) < 0.01) return false;

        return (
          parseInt(pool.totalShares) > 0 &&
          // TODO: Re-add this pool, it is leading to incorrect routes between USDC and USDT
          pool.id.toLowerCase() !==
            '0xf890360473c12d8015da8dbf7af11da87337a065000000000000000000000570'
        );
      })
      .map((pool) => {
        const totalSharesNumber = Number(pool.totalShares);
        const wrapper = computeVaultAddress({
          factoryAddress: this.factoryAddress,
          underlying: pool.id.substring(0, 42),
          initCodeHash: this.initCodeHash,
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

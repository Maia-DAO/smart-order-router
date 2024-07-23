/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { FeeAmount, Pool } from 'hermes-v2-sdk';
import JSBI from 'jsbi';
import _ from 'lodash';
import { ChainId, NativeToken } from 'maia-core-sdk';

import { unparseFeeAmount } from '../../util/amounts';
import { WRAPPED_NATIVE_CURRENCY } from '../../util/chains';
import { log } from '../../util/log';
import { ProviderConfig } from '../provider';
import {
  ARB_ARBITRUM,
  DAI_ARBITRUM,
  DAI_SEPOLIA,
  USDC_ARBITRUM,
  USDC_SEPOLIA,
  USDT_ARBITRUM,
  USDT_SEPOLIA,
  WBTC_ARBITRUM,
} from '../token-provider';

import { IV3PoolProvider } from './pool-provider';
import { IV3SubgraphProvider, V3SubgraphPool } from './subgraph-provider';

type ChainTokenList = {
  readonly [chainId in ChainId]: NativeToken[];
};

const BASES_TO_CHECK_TRADES_AGAINST: ChainTokenList = {
  [ChainId.MAINNET]: [],
  [ChainId.SEPOLIA]: [
    WRAPPED_NATIVE_CURRENCY[ChainId.SEPOLIA]!,
    USDC_SEPOLIA,
    DAI_SEPOLIA,
    USDT_SEPOLIA,
  ],
  [ChainId.OPTIMISM]: [],
  [ChainId.ARBITRUM_ONE]: [
    WRAPPED_NATIVE_CURRENCY[ChainId.ARBITRUM_ONE]!,
    WBTC_ARBITRUM,
    DAI_ARBITRUM,
    USDC_ARBITRUM,
    USDT_ARBITRUM,
    ARB_ARBITRUM,
  ],
};

/**
 * Provider that uses a hardcoded list of V3 pools to generate a list of subgraph pools.
 *
 * Since the pools are hardcoded and the data does not come from the Subgraph, the TVL values
 * are dummys and should not be depended on.
 *
 * Useful for instances where other data sources are unavailable. E.g. Subgraph not available.
 *
 * @export
 * @class StaticV3SubgraphProvider
 */
export class StaticV3SubgraphProvider implements IV3SubgraphProvider {
  constructor(
    private chainId: ChainId,
    private poolProvider: IV3PoolProvider
  ) {}

  public async getPools(
    tokenIn?: NativeToken,
    tokenOut?: NativeToken,
    providerConfig?: ProviderConfig
  ): Promise<V3SubgraphPool[]> {
    log.info('In static subgraph provider for V3');
    const bases = BASES_TO_CHECK_TRADES_AGAINST[this.chainId];

    const basePairs: [NativeToken, NativeToken][] = _.flatMap(
      bases,
      (base): [NativeToken, NativeToken][] =>
        bases.map((otherBase) => [base, otherBase])
    );

    if (tokenIn && tokenOut) {
      basePairs.push(
        [tokenIn, tokenOut],
        ...bases.map((base): [NativeToken, NativeToken] => [tokenIn, base]),
        ...bases.map((base): [NativeToken, NativeToken] => [tokenOut, base])
      );
    }

    const pairs: [NativeToken, NativeToken, FeeAmount][] = _(basePairs)
      .filter((tokens): tokens is [NativeToken, NativeToken] =>
        Boolean(tokens[0] && tokens[1])
      )
      .filter(
        ([tokenA, tokenB]) =>
          tokenA.address !== tokenB.address && !tokenA.equals(tokenB)
      )
      .flatMap<[NativeToken, NativeToken, FeeAmount]>(([tokenA, tokenB]) => {
        return [
          [tokenA, tokenB, FeeAmount.LOWEST],
          [tokenA, tokenB, FeeAmount.LOW],
          [tokenA, tokenB, FeeAmount.MEDIUM],
          [tokenA, tokenB, FeeAmount.HIGH],
        ];
      })
      .value();

    log.info(
      `V3 Static subgraph provider about to get ${pairs.length} pools on-chain`
    );
    const poolAccessor = await this.poolProvider.getPools(
      pairs,
      providerConfig
    );
    const pools = poolAccessor.getAllPools();

    const poolAddressSet = new Set<string>();
    const subgraphPools: V3SubgraphPool[] = _(pools)
      .map((pool) => {
        const { token0, token1, fee, liquidity } = pool;

        const poolAddress = Pool.getAddress(pool.token0, pool.token1, pool.fee);

        if (poolAddressSet.has(poolAddress)) {
          return undefined;
        }
        poolAddressSet.add(poolAddress);

        const liquidityNumber = JSBI.toNumber(liquidity);

        return {
          id: poolAddress,
          feeTier: unparseFeeAmount(fee),
          liquidity: liquidity.toString(),
          token0: {
            id: token0.address,
          },
          token1: {
            id: token1.address,
          },
          // As a very rough proxy we just use liquidity for TVL.
          tvlETH: liquidityNumber,
          tvlUSD: liquidityNumber,
        };
      })
      .compact()
      .value();

    return subgraphPools;
  }
}

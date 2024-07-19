import { Pair } from 'hermes-v2-sdk';
import _ from 'lodash';
import { NativeToken } from 'maia-core-sdk';
import { ChainId } from 'maia-core-sdk';

import { log } from '../../util/log';

import { IV2SubgraphProvider, V2SubgraphPool } from './subgraph-provider';

type ChainTokenList = {
  readonly [chainId in ChainId]: NativeToken[];
};

const BASES_TO_CHECK_TRADES_AGAINST: ChainTokenList = {
  // v2 is not being used, even in chains where it is deployed
  [ChainId.MAINNET]: [],
  [ChainId.SEPOLIA]: [],
  //v2 not deployed on [optimism, arbitrum, polygon, celo, gnosis, moonbeam, bnb, avalanche] and their testnets
  [ChainId.OPTIMISM]: [],
  [ChainId.ARBITRUM_ONE]: [],
};

/**
 * Provider that does not get data from an external source and instead returns
 * a hardcoded list of Subgraph pools.
 *
 * Since the pools are hardcoded, the liquidity/price values are dummys and should not
 * be depended on.
 *
 * Useful for instances where other data sources are unavailable. E.g. subgraph not available.
 *
 * @export
 * @class StaticV2SubgraphProvider
 */
export class StaticV2SubgraphProvider implements IV2SubgraphProvider {
  constructor(private chainId: ChainId) {}

  public async getPools(
    tokenIn?: NativeToken,
    tokenOut?: NativeToken
  ): Promise<V2SubgraphPool[]> {
    log.info('In static subgraph provider for V2');
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

    const pairs: [NativeToken, NativeToken][] = _(basePairs)
      .filter((tokens): tokens is [NativeToken, NativeToken] =>
        Boolean(tokens[0] && tokens[1])
      )
      .filter(
        ([tokenA, tokenB]) =>
          tokenA.address !== tokenB.address && !tokenA.equals(tokenB)
      )
      .value();

    const poolAddressSet = new Set<string>();

    const subgraphPools: V2SubgraphPool[] = _(pairs)
      .map(([tokenA, tokenB]) => {
        const poolAddress = Pair.getAddress(tokenA, tokenB);

        if (poolAddressSet.has(poolAddress)) {
          return undefined;
        }
        poolAddressSet.add(poolAddress);

        const [token0, token1] = tokenA.sortsBefore(tokenB)
          ? [tokenA, tokenB]
          : [tokenB, tokenA];

        return {
          id: poolAddress,
          liquidity: '100',
          token0: {
            id: token0.address,
          },
          token1: {
            id: token1.address,
          },
          supply: 100,
          reserve: 100,
          reserveUSD: 100,
        };
      })
      .compact()
      .value();

    return subgraphPools;
  }
}

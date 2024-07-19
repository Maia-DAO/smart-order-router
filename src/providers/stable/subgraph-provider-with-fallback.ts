import { NativeToken } from 'maia-core-sdk';

import { log } from '../../util';
import { ProviderConfig } from '../provider';

import {
  IStableSubgraphProvider,
  StableSubgraphPool,
} from './subgraph-provider';

/**
 * Provider for getting Stable subgraph pools that falls back to a different provider
 * in the event of failure.
 *
 * @export
 * @class StableSubgraphProviderWithFallBacks
 */
export class StableSubgraphProviderWithFallBacks
  implements IStableSubgraphProvider
{
  constructor(private fallbacks: IStableSubgraphProvider[]) {}

  public async getPools(
    tokenIn?: NativeToken,
    tokenOut?: NativeToken,
    providerConfig?: ProviderConfig
  ): Promise<StableSubgraphPool[]> {
    for (let i = 0; i < this.fallbacks.length; i++) {
      const provider = this.fallbacks[i]!;
      try {
        const pools = await provider.getPools(
          tokenIn,
          tokenOut,
          providerConfig
        );
        return pools;
      } catch (err) {
        log.info(`Failed to get subgraph pools for Stable from fallback #${i}`);
      }
    }

    throw new Error('Failed to get subgraph pools from any providers');
  }
}

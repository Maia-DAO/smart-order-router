import { BigNumber } from '@ethersproject/bignumber';
import { ChainId } from 'maia-core-sdk';

import { AAVE_MAINNET, LIDO_MAINNET } from '../../../../providers';
import { StableRoute } from '../../../router';

//l2 execution fee on optimism is roughly the same as mainnet
export const BASE_SWAP_COST = (id: ChainId): BigNumber => {
  switch (id) {
    case ChainId.ARBITRUM_ONE:
      return BigNumber.from(100000);
    case ChainId.MAINNET:
    case ChainId.SEPOLIA:
    case ChainId.OPTIMISM:
      return BigNumber.from(70000);
  }
};

export const COST_PER_HOP = (id: ChainId): BigNumber => {
  switch (id) {
    case ChainId.ARBITRUM_ONE:
      return BigNumber.from(35000);
    case ChainId.MAINNET:
    case ChainId.SEPOLIA:
    case ChainId.OPTIMISM:
      return BigNumber.from(35000);
  }
};

export const SINGLE_HOP_OVERHEAD = (_id: ChainId): BigNumber => {
  return BigNumber.from(10000);
};

export const TOKEN_OVERHEAD = (id: ChainId, route: StableRoute): BigNumber => {
  let overhead = BigNumber.from(0);

  if (id == ChainId.MAINNET) {
    // AAVE's transfer contains expensive governance snapshotting logic. We estimate
    // it at around 150k.
    if (route.input.equals(AAVE_MAINNET) || route.output.equals(AAVE_MAINNET)) {
      overhead = overhead.add(150000);
    }

    // LDO's reaches out to an external token controller which adds a large overhead
    // of around 150k.
    if (route.input.equals(LIDO_MAINNET) || route.output.equals(LIDO_MAINNET)) {
      overhead = overhead.add(150000);
    }
  }

  return overhead;
};

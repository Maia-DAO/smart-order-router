import { BigNumber } from '@ethersproject/bignumber';
import { ChainId } from 'maia-core-sdk';

// TODO: Add real values to this, these are just placeholders for now.

//l2 execution fee on optimism is roughly the same as mainnet
export const BASE_SWAP_COST = (id: ChainId): BigNumber => {
  switch (id) {
    case ChainId.ARBITRUM_ONE:
      return BigNumber.from(5000);
    case ChainId.MAINNET:
    case ChainId.SEPOLIA:
    case ChainId.OPTIMISM:
      return BigNumber.from(2000);
  }
};

export const COST_PER_HOP = (id: ChainId): BigNumber => {
  switch (id) {
    case ChainId.ARBITRUM_ONE:
      return BigNumber.from(50000);
    case ChainId.MAINNET:
    case ChainId.SEPOLIA:
    case ChainId.OPTIMISM:
      return BigNumber.from(50000);
  }
};

export const SINGLE_HOP_OVERHEAD = (_id: ChainId): BigNumber => {
  return BigNumber.from(10000);
};

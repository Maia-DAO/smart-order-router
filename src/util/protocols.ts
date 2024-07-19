import { Protocol } from 'hermes-swap-router-sdk';

export const TO_PROTOCOL = (protocol: string): Protocol => {
  switch (protocol.toLowerCase()) {
    case 'v3':
      return Protocol.V3;
    case 'v2':
      return Protocol.V2;
    case 'bal':
      return Protocol.BAL_STABLE;
    case 'erc4626':
      return Protocol.BAL_STABLE_WRAPPER;
    case 'mixed':
      return Protocol.MIXED;
    default:
      throw new Error(`Unknown protocol: {id}`);
  }
};

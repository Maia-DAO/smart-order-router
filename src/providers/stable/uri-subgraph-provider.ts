import { URISubgraphProvider } from '../uri-subgraph-provider';

import {
  IStableSubgraphProvider,
  StableSubgraphPool,
} from './subgraph-provider';

export class StableURISubgraphProvider
  extends URISubgraphProvider<StableSubgraphPool>
  implements IStableSubgraphProvider {}

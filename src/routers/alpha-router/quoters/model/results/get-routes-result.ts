import { AllRoutes } from '../../../../router';
import { CandidatePoolsBySelectionCriteria } from '../../../functions/get-candidate-pools';

export interface GetRoutesResult<Route extends AllRoutes> {
  routes: Route[];
  candidatePools: CandidatePoolsBySelectionCriteria;
}

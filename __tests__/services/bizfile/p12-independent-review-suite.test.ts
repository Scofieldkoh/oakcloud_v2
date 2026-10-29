// CI visibility shim for the P12 reviewer workstream.
// The repository's Node 24 workflow targets __tests__/services/bizfile, while
// the isolated reviewer tests live beside the reviewer modules. Importing them
// here makes those tests part of the existing BizFile contract job without
// changing production registration or mutation behaviour.
import '../../../src/services/bizfile/application/__tests__/full-state-independent-review.test';
import '../../../src/services/bizfile/application/__tests__/full-state-review-contract.test';
import '../../../src/services/bizfile/application/__tests__/reviewer-independence.test';
import '../../../src/services/bizfile/application/__tests__/review-evidence-provenance.test';
import '../../../src/services/bizfile/application/__tests__/reviewer-annotated-fixtures.test';
import '../../../src/services/bizfile/application/__tests__/review-evidence-integrity.test';
import '../../../src/services/bizfile/application/__tests__/reviewer-evaluation.test';
import '../../../src/services/bizfile/application/__tests__/complete-independent-source-review.test';
import '../../../src/services/bizfile/application/__tests__/held-out/reviewer-fixture-isolation.test';
import '../../../src/services/bizfile/application/__tests__/held-out/reviewer-held-out-evaluation.test';

/** Public IDs only. Private records never belong in this file or a Pages artifact. */
export const EOC_CONFIG=Object.freeze({
  enabled:false,
  environment:'exercise',
  // Replace with the public configuration produced by scripts/provision-eoc.py.
  orgId:'',
  groups:{viewers:'',reporters:'',reviewers:'',coordinators:'',recorders:'',approvers:''},
  // Every collection needs a Query-only read view and an add-only write view.
  // Recorders/approvers have separate server-enforced groups and views.
  collections:{},
  pollMs:60000
});

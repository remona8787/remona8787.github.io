// TourAPI + Seoul Open Data connector scaffold.
// Credentials needed: TOURAPI_SERVICE_KEY / SEOUL_OPEN_DATA_KEY.
// Intentionally does not invent endpoint mappings before the first authenticated response.

Deno.serve(async (_req) => {
  const tour = Deno.env.get("TOURAPI_SERVICE_KEY");
  const seoul = Deno.env.get("SEOUL_OPEN_DATA_KEY");
  if (!tour && !seoul) {
    return new Response(JSON.stringify({
      ok:false,
      ready:false,
      message:"Connector scaffold ready. Add TourAPI and/or Seoul Open Data credentials."
    }), {status:503, headers:{"content-type":"application/json"}});
  }

  // Production mapping plan:
  // - TourAPI: location/keyword/event/image/sync-list operations
  // - Seoul: culture-event + culture-space feeds
  // - normalize into events + editorial_review_queue
  // - preserve source URL/provider IDs/provenance
  // - default new candidates to unpublished until relevance rules pass
  return new Response(JSON.stringify({ok:false, message:"Credentials detected; implement first live response mapping."}),
    {status:501,headers:{"content-type":"application/json"}});
});

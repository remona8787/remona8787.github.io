// Wikidata enrichment scaffold.
// Use for durable QIDs / coordinates / architect / inception / official website.
// Send ambiguous matches to editorial review instead of auto-linking.

Deno.serve(async (_req) => {
  return new Response(JSON.stringify({
    ok:false, ready:false,
    endpoint:"https://query.wikidata.org/sparql",
    rule:"Conservative matching; store QID in external_place_links."
  }), {status:501,headers:{"content-type":"application/json"}});
});

// Ticketmaster Discovery API event scaffold.
// Credential: TICKETMASTER_API_KEY.
// Use as event source, not permanent place truth.

Deno.serve(async (_req) => {
  const key = Deno.env.get("TICKETMASTER_API_KEY");
  if (!key) {
    return new Response(JSON.stringify({ok:false,ready:false,message:"Set TICKETMASTER_API_KEY"}),
      {status:503,headers:{"content-type":"application/json"}});
  }
  return new Response(JSON.stringify({
    ok:false, ready:false,
    rule:"Query selected markets/date windows; normalize candidate events; default unpublished until relevance check."
  }), {status:501,headers:{"content-type":"application/json"}});
});

// Google Places / Foursquare targeted refresh scaffold.
// Use durable provider ID mapping; treat live fields as TTL snapshots.
// Do not bulk-mirror provider databases.

Deno.serve(async (req) => {
  const body = await req.json().catch(()=>({}));
  const provider = body.provider;
  const placeId = body.placeId;
  if (!provider || !placeId) {
    return new Response(JSON.stringify({ok:false,error:"provider and placeId required"}), {
      status:400, headers:{"content-type":"application/json"}
    });
  }
  return new Response(JSON.stringify({
    ok:false, ready:true, provider, placeId,
    message:"Add provider key and external place ID mapping, then fetch allowed live fields only."
  }), {status:501, headers:{"content-type":"application/json"}});
});

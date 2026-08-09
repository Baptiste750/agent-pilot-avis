import { handleApi, initApi } from "../api-handler.js";

let readyPromise;

export default async function handler(req, res) {
  readyPromise ||= initApi();
  try {
    await readyPromise;
  } catch (error) {
    readyPromise = undefined;
    console.error(error);
    res.status(503).json({
      error: "Stockage Supabase indisponible. Le projet est probablement en pause, réactivez-le depuis le dashboard Supabase."
    });
    return;
  }
  if (req.query?.path) {
    const path = Array.isArray(req.query.path) ? req.query.path.join("/") : req.query.path;
    const queryIndex = req.url.indexOf("?");
    const query = queryIndex >= 0 ? req.url.slice(queryIndex) : "";
    req.url = `/api/${path}${query}`;
  }
  await handleApi(req, res);
}

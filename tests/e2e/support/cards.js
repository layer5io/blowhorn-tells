// The shared card variants load from blowhorn.ai. The end-to-end suite stays hermetic: the request
// gets an empty stylesheet. Tests check the variant classes and the page's own styles, not the
// shared file's look.
export const SHARED_CARDS_URL = "https://blowhorn.ai/assets/brand/cards.css";

export async function stubSharedCards(page) {
  await page.route(SHARED_CARDS_URL, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
}

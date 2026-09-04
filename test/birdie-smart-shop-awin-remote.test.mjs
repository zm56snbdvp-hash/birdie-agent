import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/affiliate-commerce/providers/csv.mjs";
import { createAwinFeedClient, createAwinRemoteCatalogProvider } from "../src/affiliate-commerce/providers/awin-remote.mjs";

test("CSV parser handles quoted commas, escaped quotes and embedded newlines", () => {
  const rows = parseCsv('id,name,description\n1,"Golf, Ball","Line one\nLine two"\n2,"A ""quoted"" name",ok\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Golf, Ball");
  assert.equal(rows[0].description, "Line one\nLine two");
  assert.equal(rows[1].name, 'A "quoted" name');
});

test("Awin feed client maps feed-list metadata without exposing the API key", async () => {
  const requests = [];
  const client = createAwinFeedClient({
    dataFeedApiKey: "secret-key",
    fetchImpl: async (url) => {
      requests.push(url);
      return {
        ok: true,
        async text() {
          return 'Advertiser ID,Advertiser Name,Primary Region,Membership Status,Feed ID,Feed Name,Language,Vertical,Last Imported,URL\n11742,Golf und Günstig,DE,Joined,501,Default,German,Retail,2026-09-04 02:00:00,https://datafeed.api.productserve.com/datafeed/download/apikey/hidden/fid/501/format/csv\n';
        }
      };
    }
  });
  const feeds = await client.listFeeds();
  assert.equal(feeds[0].advertiserId, "11742");
  assert.equal(feeds[0].membershipStatus, "Joined");
  assert.equal(feeds[0].lastImported, "2026-09-04 02:00:00");
  assert.match(requests[0], /secret-key/);
  assert.equal(JSON.stringify(feeds).includes("secret-key"), false);
});

test("remote Awin catalog only downloads joined selected German advertiser feeds", async () => {
  const downloaded = [];
  const feedClient = {
    async listFeeds() {
      return [
        { advertiserId: "11742", advertiserName: "Golf und Günstig", primaryRegion: "DE", membershipStatus: "Joined", feedId: "1", lastImported: "A", url: "https://datafeed.api.productserve.com/a" },
        { advertiserId: "11593", advertiserName: "Golf House", primaryRegion: "DE", membershipStatus: "Not Joined", feedId: "2", lastImported: "A", url: "https://datafeed.api.productserve.com/b" },
        { advertiserId: "999", advertiserName: "Other", primaryRegion: "DE", membershipStatus: "Joined", feedId: "3", lastImported: "A", url: "https://datafeed.api.productserve.com/c" }
      ];
    },
    async downloadRows(feed) {
      downloaded.push(feed.advertiserId);
      return [{
        aw_product_id: "ball-1",
        product_name: "Golf Balls",
        aw_deep_link: "https://www.awin1.com/cread.php?x=1",
        search_price: "29.99",
        in_stock: "1"
      }];
    }
  };
  const provider = createAwinRemoteCatalogProvider({ feedClient, advertiserIds: ["11742", "11593"], region: "DE" });
  const products = await provider.listProducts();
  assert.deepEqual(downloaded, ["11742"]);
  assert.equal(products.length, 1);
  assert.equal(products[0].provider, "awin:11742");
});

test("remote Awin catalog reuses unchanged feeds and reloads after Last Imported changes", async () => {
  let version = "A";
  let downloads = 0;
  const feedClient = {
    async listFeeds() {
      return [{ advertiserId: "11742", advertiserName: "Golf und Günstig", primaryRegion: "DE", membershipStatus: "Joined", feedId: "1", lastImported: version, url: "https://datafeed.api.productserve.com/a" }];
    },
    async downloadRows() {
      downloads += 1;
      return [{ aw_product_id: "ball-1", product_name: "Golf Balls", aw_deep_link: "https://www.awin1.com/cread.php?x=1", search_price: "29.99", in_stock: "1" }];
    }
  };
  const provider = createAwinRemoteCatalogProvider({ feedClient, advertiserIds: ["11742"] });
  await provider.listProducts();
  await provider.listProducts();
  assert.equal(downloads, 1);
  version = "B";
  await provider.listProducts();
  assert.equal(downloads, 2);
});

test("Awin feed client rejects untrusted product-feed redirect URLs", async () => {
  const client = createAwinFeedClient({ dataFeedApiKey: "x", fetchImpl: async () => ({ ok: true, async text() { return ""; } }) });
  await assert.rejects(client.downloadRows({ url: "https://evil.example/feed.csv" }), (error) => error.code === "AWIN_FEED_URL_INVALID");
});

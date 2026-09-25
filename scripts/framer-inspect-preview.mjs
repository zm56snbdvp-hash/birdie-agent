import { connect } from "framer-api";

const projectUrl = process.env.FRAMER_PROJECT_URL;
const apiKey = process.env.FRAMER_API_KEY;
if (!projectUrl || !apiKey) throw new Error("Missing Framer config");

const framer = await connect(projectUrl, apiKey);
try {
  const out = {};
  if (typeof framer.getProjectInfo === "function") out.projectInfo = await framer.getProjectInfo();
  if (typeof framer.getPublishInfo === "function") out.publishInfo = await framer.getPublishInfo();
  if (typeof framer.getChangedPaths === "function") out.changedPaths = await framer.getChangedPaths();
  if (typeof framer.getUnpublishedPageChanges === "function") {
    try { out.unpublishedPageChanges = await framer.getUnpublishedPageChanges(); } catch (e) { out.unpublishedPageChangesError = e?.message || String(e); }
  }
  if (typeof framer.listDeployments === "function") {
    try {
      const deps = await framer.listDeployments();
      out.deployments = (deps || []).slice(0,10).map(d => ({
        id:d?.id || null,status:d?.status || null,createdAt:d?.createdAt || null,updatedAt:d?.updatedAt || null
      }));
    } catch (e) { out.deploymentsError = e?.message || String(e); }
  }

  const pages = await framer.getNodesWithType("WebPageNode");
  out.pages = [];
  for (const page of pages || []) {
    const p = { id: page.id, path: page.path, draft: page.draft ?? null };
    try {
      const children = await page.getChildren();
      p.children = (children || []).map(ch => ({
        id: ch?.id || null,
        type: ch?.constructor?.name || ch?.nodeType || null,
        name: ch?.name || null,
        width: ch?.width ?? null,
        height: ch?.height ?? null,
        visible: ch?.visible ?? null,
        componentIdentifier: ch?.componentIdentifier || null,
        componentName: ch?.componentName || null
      }));
    } catch (e) { p.childrenError = e?.message || String(e); }
    try {
      const frames = await page.getNodesWithType("FrameNode");
      p.frames = (frames || []).slice(0,20).map(n => ({
        id:n?.id||null,name:n?.name||null,isBreakpoint:n?.isBreakpoint??null,isPrimaryBreakpoint:n?.isPrimaryBreakpoint??null,
        width:n?.width??null,height:n?.height??null
      }));
    } catch (e) { p.framesError = e?.message || String(e); }
    try {
      const instances = await page.getNodesWithType("ComponentInstanceNode");
      p.instances = (instances || []).map(n => ({
        id:n?.id||null,name:n?.name||null,componentIdentifier:n?.componentIdentifier||null,componentName:n?.componentName||null,
        width:n?.width??null,height:n?.height??null,visible:n?.visible??null
      }));
    } catch (e) { p.instancesError = e?.message || String(e); }
    out.pages.push(p);
  }

  if (typeof framer.getCodeFiles === "function") {
    const files = await framer.getCodeFiles();
    out.codeFiles = (files || []).map(f => ({
      id:f?.id||null,name:f?.name||null,path:f?.path||null,versionId:f?.versionId||null,
      exports:(f?.exports||[]).map(x=>({type:x?.type||null,name:x?.name||null,insertURL:x?.insertURL||null}))
    }));
  }

  process.stdout.write(JSON.stringify(out,null,2)+"\n");
} finally {
  await framer.disconnect();
}

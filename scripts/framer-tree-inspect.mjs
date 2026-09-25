import { connect } from "framer-api";

const projectUrl = process.env.FRAMER_PROJECT_URL;
const apiKey = process.env.FRAMER_API_KEY;
if (!projectUrl || !apiKey) throw new Error("Missing Framer config");

const framer = await connect(projectUrl, apiKey);

async function describe(node, depth = 0, seen = new Set()) {
  if (!node || seen.has(node.id) || depth > 8) return null;
  if (node.id) seen.add(node.id);

  const out = {
    id: node?.id || null,
    type: node?.constructor?.name || node?.nodeType || null,
    name: node?.name || null,
    path: node?.path || null,
    visible: node?.visible ?? null,
    width: node?.width ?? null,
    height: node?.height ?? null,
    isBreakpoint: node?.isBreakpoint ?? null,
    isPrimaryBreakpoint: node?.isPrimaryBreakpoint ?? null,
    componentName: node?.componentName || null,
    componentIdentifier: node?.componentIdentifier || null,
    backgroundColor: node?.backgroundColor ?? null,
    overflow: node?.overflow ?? null
  };

  if (typeof node.getParent === "function") {
    try {
      const p = await node.getParent();
      out.parentId = p?.id || null;
      out.parentName = p?.name || null;
      out.parentType = p?.constructor?.name || null;
    } catch {}
  }

  if (typeof node.getChildren === "function") {
    try {
      const children = await node.getChildren();
      out.children = [];
      for (const child of children || []) {
        const c = await describe(child, depth + 1, seen);
        if (c) out.children.push(c);
      }
    } catch (e) {
      out.childrenError = e?.message || String(e);
    }
  }

  return out;
}

try {
  const pages = await framer.getNodesWithType("WebPageNode");
  const page = (pages || []).find(p => p?.path === "/new-birdie");
  if (!page) throw new Error("/new-birdie not found");

  const codeFile = typeof framer.getCodeFile === "function"
    ? await framer.getCodeFile("BirdieBrandHome.tsx")
    : null;

  let versions = [];
  if (codeFile && typeof codeFile.getVersions === "function") {
    try {
      versions = await codeFile.getVersions();
    } catch {}
  }

  const result = {
    projectInfo: typeof framer.getProjectInfo === "function" ? await framer.getProjectInfo() : null,
    publishInfo: typeof framer.getPublishInfo === "function" ? await framer.getPublishInfo() : null,
    page: await describe(page),
    codeFile: codeFile ? {
      id: codeFile.id || null,
      name: codeFile.name || null,
      path: codeFile.path || null,
      content: codeFile.content || null,
      exports: codeFile.exports || [],
      versions: (versions || []).slice(0,10).map(v => ({
        id: v?.id || null,
        createdAt: v?.createdAt || null
      }))
    } : null,
    allFrames: [],
    allInstances: []
  };

  const frames = await page.getNodesWithType("FrameNode");
  for (const n of frames || []) {
    result.allFrames.push({
      id:n.id,name:n.name,parentId:(await n.getParent())?.id || null,
      isBreakpoint:n.isBreakpoint ?? null,isPrimaryBreakpoint:n.isPrimaryBreakpoint ?? null,
      width:n.width ?? null,height:n.height ?? null,visible:n.visible ?? null
    });
  }

  const instances = await page.getNodesWithType("ComponentInstanceNode");
  for (const n of instances || []) {
    result.allInstances.push({
      id:n.id,name:n.name,parentId:(await n.getParent())?.id || null,
      componentName:n.componentName || null,componentIdentifier:n.componentIdentifier || null,
      width:n.width ?? null,height:n.height ?? null,visible:n.visible ?? null
    });
  }

  process.stdout.write(JSON.stringify(result,null,2)+"\n");
} finally {
  await framer.disconnect();
}

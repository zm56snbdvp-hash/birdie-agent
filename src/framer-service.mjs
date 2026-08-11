function configError(name) {
  const error = new Error(`${name} is not configured`);
  error.code = "FRAMER_NOT_CONFIGURED";
  error.status = 503;
  return error;
}

function requireConfig() {
  const projectUrl = process.env.FRAMER_PROJECT_URL;
  const apiKey = process.env.FRAMER_API_KEY;
  if (!projectUrl) throw configError("FRAMER_PROJECT_URL");
  if (!apiKey) throw configError("FRAMER_API_KEY");
  return { projectUrl, apiKey };
}

async function withFramer(operation) {
  const { projectUrl, apiKey } = requireConfig();
  const { connect } = await import("framer-api");
  const framer = await connect(projectUrl, apiKey);
  try {
    return await operation(framer);
  } finally {
    await framer.disconnect();
  }
}

export function isFramerConfigured() {
  return Boolean(process.env.FRAMER_PROJECT_URL && process.env.FRAMER_API_KEY);
}

export async function getFramerStatus() {
  return withFramer(async (framer) => {
    const [project, publishInfo, changedPaths] = await Promise.all([
      framer.getProjectInfo(),
      framer.getPublishInfo(),
      framer.getChangedPaths()
    ]);

    return {
      configured: true,
      project: {
        id: project?.id || null,
        name: project?.name || null
      },
      publishInfo,
      changedPaths
    };
  });
}

export async function publishFramerPreview() {
  return withFramer(async (framer) => {
    const before = await framer.getChangedPaths();
    const result = await framer.publish();
    return {
      mode: "PREVIEW_ONLY",
      productionDeployed: false,
      changedPaths: before,
      deployment: result?.deployment || null,
      hostnames: result?.hostnames || null
    };
  });
}

export async function deployFramerProduction(deploymentId) {
  if (!deploymentId || !String(deploymentId).trim()) {
    const error = new Error("deploymentId is required");
    error.code = "INVALID_DEPLOYMENT_ID";
    error.status = 400;
    throw error;
  }

  return withFramer(async (framer) => {
    await framer.deploy(String(deploymentId).trim());
    return {
      mode: "PRODUCTION_DEPLOY",
      deployed: true,
      deploymentId: String(deploymentId).trim()
    };
  });
}

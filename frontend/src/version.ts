type ParsedVersion = {
  core: number[];
  prerelease: string[];
};

const parseVersion = (version: string): ParsedVersion | null => {
  const withoutBuildMetadata = version.trim().replace(/^v/i, "").split("+", 1)[0];
  const [coreVersion, ...prereleaseParts] = withoutBuildMetadata.split("-");

  if (!/^\d+(?:\.\d+)*$/.test(coreVersion)) {
    return null;
  }

  return {
    core: coreVersion.split(".").map(Number),
    prerelease: prereleaseParts.join("-").split(".").filter(Boolean),
  };
};

export const isServerVersionNewer = (serverVersion: string, localVersion: string) => {
  const server = parseVersion(serverVersion);
  const local = parseVersion(localVersion);

  if (!server || !local) {
    return false;
  }

  const coreLength = Math.max(server.core.length, local.core.length);
  for (let index = 0; index < coreLength; index += 1) {
    const serverPart = server.core[index] ?? 0;
    const localPart = local.core[index] ?? 0;
    if (serverPart !== localPart) {
      return serverPart > localPart;
    }
  }

  if (server.prerelease.length === 0 || local.prerelease.length === 0) {
    return server.prerelease.length === 0 && local.prerelease.length > 0;
  }

  const prereleaseLength = Math.max(server.prerelease.length, local.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const serverPart = server.prerelease[index];
    const localPart = local.prerelease[index];

    if (serverPart === undefined || localPart === undefined) {
      return localPart === undefined;
    }
    if (serverPart === localPart) {
      continue;
    }

    const serverNumber = /^\d+$/.test(serverPart) ? Number(serverPart) : null;
    const localNumber = /^\d+$/.test(localPart) ? Number(localPart) : null;
    if (serverNumber !== null && localNumber !== null) {
      return serverNumber > localNumber;
    }
    if (serverNumber !== null || localNumber !== null) {
      return serverNumber === null;
    }

    return serverPart > localPart;
  }

  return false;
};

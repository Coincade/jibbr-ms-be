import { isPolicyAllowedForResource } from "./collaborationAccess.js";

describe("collaboration policy matrix", () => {
  const basePolicy = {
    allowExternalDiscovery: false,
    allowCrossWorkspaceDm: false,
    allowSharedChannels: false,
  };

  it("maps workspace access to allowExternalDiscovery", () => {
    expect(
      isPolicyAllowedForResource("workspace", {
        ...basePolicy,
        allowExternalDiscovery: true,
      })
    ).toBe(true);
    expect(
      isPolicyAllowedForResource("workspace", {
        ...basePolicy,
        allowExternalDiscovery: false,
      })
    ).toBe(false);
  });

  it("maps conversation access to allowCrossWorkspaceDm", () => {
    expect(
      isPolicyAllowedForResource("conversation", {
        ...basePolicy,
        allowCrossWorkspaceDm: true,
      })
    ).toBe(true);
    expect(
      isPolicyAllowedForResource("conversation", {
        ...basePolicy,
        allowCrossWorkspaceDm: false,
      })
    ).toBe(false);
  });

  it("maps channel and message access to allowSharedChannels", () => {
    expect(
      isPolicyAllowedForResource("channel", {
        ...basePolicy,
        allowSharedChannels: true,
      })
    ).toBe(true);
    expect(
      isPolicyAllowedForResource("message", {
        ...basePolicy,
        allowSharedChannels: true,
      })
    ).toBe(true);
    expect(
      isPolicyAllowedForResource("channel", {
        ...basePolicy,
        allowSharedChannels: false,
      })
    ).toBe(false);
  });
});

// Profile screen and child editor (src/app/(tabs)/profile): role badge, which children are listed,

// who may add a child, and the child-account chip and section.
import { router } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";

import ChildEditor from "@/app/(tabs)/profile/child/[id]";
import Profile from "@/app/(tabs)/profile/index";
import { useAccount } from "@/core/account/account-store";
import { listChildren } from "@/core/account/api";
import { useSession } from "@/core/auth/session-store";
import { id } from "@/core/i18n/id";
import { ThemeProvider } from "@/core/theme";
import { useLocalData } from "@/data/local-store";
import {
  DEFAULT_LIMITS,
  type ChildSummary,
  type MyAccount,
} from "@/domain/models";

jest.mock("@/core/auth/supabase", () => ({
  supabase: {
    rpc: jest.fn(),
    auth: {
      refreshSession: jest.fn(),
      signOut: jest.fn(),
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
    },
  },
}));
jest.mock("@/core/account/api", () => ({
  ...jest.requireActual("@/core/account/api"),
  listChildren: jest.fn(),
}));

const mockParams: { id: string } = { id: "new" };
jest.mock("expo-router", () => {
  const mockReact = jest.requireActual("react");
  return {
    router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
    Stack: { Screen: () => null },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void) => mockReact.useEffect(cb, [cb]),
  };
});

const USER = "0b0b0b0b-0000-4000-8000-000000000001";
const KID = "c0c0c0c0-0000-4000-8000-000000000001";
const KID2 = "c0c0c0c0-0000-4000-8000-000000000002";
const SELF = "c0c0c0c0-0000-4000-8000-0000000000ff";
const tc = id.childAccounts;

function account(over: Partial<MyAccount> = {}): MyAccount {
  return {
    userId: USER,
    accountType: "guardian",
    roles: ["guardian"],
    selfChildId: null,
    childAccounts: 1,
    childAccount: null,
    flags: { brushingProofVideo: false },
    capabilities: { createChildAccounts: true, registerProofs: false },
    limits: DEFAULT_LIMITS,
    ...over,
  };
}

function row(childId: string, over: Partial<ChildSummary> = {}): ChildSummary {
  return {
    childId,
    isSelf: false,
    birthYear: 2016,
    birthMonth: 3,
    consents: ["b"],
    hasChildAccount: false,
    childAccountDisabled: null,
    username: null,
    lastScreeningAt: null,
    lastScreeningLevel: null,
    lastBrushingAt: null,
    openRequests: 0,
    unseenRequests: 0,
    unviewedProofs: 0,
    deletionPending: false,
    ...over,
  };
}

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 800 },
  insets: { top: 24, left: 0, right: 0, bottom: 16 },
};
async function renderUi(node: React.ReactNode) {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>{node}</ThemeProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.id = "new";
  (listChildren as jest.Mock).mockReset().mockResolvedValue({
    ok: true,
    data: [
      row(KID, {
        hasChildAccount: true,
        childAccountDisabled: false,
        username: "si.budi",
      }),
      row(KID2),
    ],
  });
  useSession.setState({
    status: "signedIn",
    userId: USER,
    email: "ortu@contoh.com",
  });
  useAccount.setState({
    userId: USER,
    me: account(),
    status: "ready",
    lastError: null,
  });
  useLocalData.setState({
    scope: null,
    ready: true,
    kids: [
      {
        id: KID,
        nickname: "Budi",
        birthYear: 2016,
        birthMonth: 3,
        allergies: [],
      },
      {
        id: KID2,
        nickname: "Sari",
        birthYear: 2018,
        birthMonth: 1,
        allergies: [],
      },
    ],
    activeChildId: KID,
    consentRecords: {},
    consents: {},
    unsyncedChildren: [],
    syncBlocked: {},
  });
});

describe("Profile", () => {
  it("shows the guardian badge, all children and a status chip per child", async () => {
    await renderUi(<Profile />);
    expect(screen.getByText(id.profile.roleGuardian)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getAllByTestId("kid-status-chip")).toHaveLength(2),
    );
    expect(screen.getByText(tc.list.chipActive)).toBeTruthy();
    expect(screen.getByText(tc.list.chipNone)).toBeTruthy();
    expect(screen.getByTestId("add-child")).toBeTruthy();
  });

  it("adds a fallback name for a child that only the server knows", async () => {
    useLocalData.setState({
      kids: [
        {
          id: KID,
          nickname: "",
          birthYear: 2016,
          birthMonth: 3,
          allergies: [],
        },
      ],
    });
    await renderUi(<Profile />);
    expect(screen.getByText(tc.list.fallbackName(1))).toBeTruthy();
  });

  it("merges children that exist only on the server", async () => {
    useLocalData.setState({
      kids: [
        {
          id: KID,
          nickname: "Budi",
          birthYear: 2016,
          birthMonth: 3,
          allergies: [],
        },
      ],
    });
    await renderUi(<Profile />);
    await waitFor(() =>
      expect(useLocalData.getState().kids.some((k) => k.id === KID2)).toBe(
        true,
      ),
    );
    await waitFor(() =>
      expect(screen.getByText(tc.list.fallbackName(2))).toBeTruthy(),
    );
  });

  it('shows a teen the Remaja badge, only the own profile and no "Tambah anak"', async () => {
    useAccount.setState({
      me: account({
        accountType: "teen",
        selfChildId: SELF,
        childAccounts: null,
        capabilities: { createChildAccounts: false, registerProofs: true },
      }),
    });
    useLocalData.setState({
      kids: [
        {
          id: SELF,
          nickname: "Saya",
          birthYear: 2009,
          birthMonth: 5,
          allergies: [],
          isSelf: true,
        },
        {
          id: KID,
          nickname: "Budi",
          birthYear: 2016,
          birthMonth: 3,
          allergies: [],
        },
      ],
    });
    await renderUi(<Profile />);
    expect(screen.getByText(id.profile.roleTeen)).toBeTruthy();
    expect(screen.getByTestId(`kid-row-${SELF}`)).toBeTruthy();
    expect(screen.queryByTestId(`kid-row-${KID}`)).toBeNull();
    expect(screen.queryByTestId("add-child")).toBeNull();
    expect(screen.queryByTestId("kid-status-chip")).toBeNull();
  });

  it('hides "Tambah anak" for a guardian without the capability', async () => {
    useAccount.setState({
      me: account({
        capabilities: { createChildAccounts: false, registerProofs: false },
      }),
    });
    await renderUi(<Profile />);
    expect(screen.queryByTestId("add-child")).toBeNull();
  });

  it("keeps local add-child for a guest", async () => {
    useSession.setState({ status: "guest", userId: null, email: null });
    useAccount.setState({ me: null, userId: null });
    await renderUi(<Profile />);
    expect(screen.getByTestId("add-child")).toBeTruthy();
    expect(screen.queryByTestId("kid-status-chip")).toBeNull();
    expect(listChildren).not.toHaveBeenCalled();
  });

  it('keeps "Tambah anak" for a guardian on a backend without account v2', async () => {
    useAccount.setState({
      me: {
        ...account({
          capabilities: { createChildAccounts: false, registerProofs: false },
        }),
        legacy: true,
      },
    });
    await renderUi(<Profile />);
    expect(screen.getByTestId("add-child")).toBeTruthy();
    expect(listChildren).not.toHaveBeenCalled();
  });
});

describe("Child editor", () => {
  it("points to the child-account screen for an existing child", async () => {
    mockParams.id = KID;
    await renderUi(<ChildEditor />);
    await waitFor(() =>
      expect(screen.getByText(tc.section.openManage)).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId("child-account-row"));
    expect(router.push).toHaveBeenCalledWith(`/profile/child-account/${KID}`);
  });

  it("offers to create an account when the child has none", async () => {
    mockParams.id = KID2;
    await renderUi(<ChildEditor />);
    await waitFor(() =>
      expect(screen.getByText(tc.section.openCreate)).toBeTruthy(),
    );
  });

  it("asks to save a new child first", async () => {
    await renderUi(<ChildEditor />);
    expect(screen.getByText(tc.section.saveFirst)).toBeTruthy();
    expect(screen.queryByTestId("child-account-row")).toBeNull();
  });

  it("has no account section without the capability", async () => {
    useAccount.setState({
      me: account({
        capabilities: { createChildAccounts: false, registerProofs: false },
      }),
    });
    mockParams.id = KID;
    await renderUi(<ChildEditor />);
    expect(screen.queryByTestId("child-account-row")).toBeNull();
    expect(screen.queryByText(tc.section.title)).toBeNull();
  });

  it("saves edits through the local store", async () => {
    mockParams.id = KID;
    await renderUi(<ChildEditor />);
    await fireEvent.changeText(
      screen.getByLabelText(id.child.nickname),
      "Budi K",
    );
    await fireEvent.press(screen.getByText(id.common.save));
    expect(
      useLocalData.getState().kids.find((k) => k.id === KID)?.nickname,
    ).toBe("Budi K");
    expect(router.back).toHaveBeenCalled();
  });

  it("saves new child, activates it, and grants consent a", async () => {
    mockParams.id = "new";
    await renderUi(<ChildEditor />);
    await fireEvent.changeText(
      screen.getByLabelText(id.child.nickname),
      "Siti",
    );
    await fireEvent.press(screen.getByText(id.common.save));
    const newKid = useLocalData
      .getState()
      .kids.find((k) => k.nickname === "Siti");
    expect(newKid).toBeDefined();
    expect(useLocalData.getState().activeChildId).toBe(newKid?.id);
    expect(useLocalData.getState().consents[newKid!.id]?.a).toBe(true);
    expect(router.back).toHaveBeenCalled();
  });
});

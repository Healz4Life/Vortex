import { addCollectionAction, removeCollectionAction } from "../collectionCreate";

jest.mock("vortex-api", () => ({
  actions: {
    addModRule: jest.fn((gameId, collectionId, rule) => ({
      type: "ADD_MOD_RULE",
      gameId,
      collectionId,
      rule,
    })),
    removeModRule: jest.fn((gameId, collectionId, rule) => ({
      type: "REMOVE_MOD_RULE",
      gameId,
      collectionId,
      rule,
    })),
  },
  selectors: {
    activeGameId: jest.fn(() => "game"),
  },
  util: {
    batchDispatch: jest.fn(),
    calcDuration: jest.fn(),
    getSafe: jest.fn(),
    renderModName: jest.fn((mod) => mod.id),
  },
}));

jest.mock("../util/transformCollection", () => ({
  createCollectionFromProfile: jest.fn(),
  showQuickCollectionRestrictionsDialog: jest.fn(),
}));

jest.mock("../util/util", () => ({
  uploadCollection: jest.fn(),
}));

const makeMod = (id: string, rules: Array<{ reference: { id: string } }> = [], editable = true) => ({
  id,
  type: id.startsWith("collection-") ? "collection" : "mod",
  attributes: { editable },
  rules,
});

function makeApi(
  mods: Record<string, ReturnType<typeof makeMod>>,
  action: string,
  input: Record<string, boolean>,
) {
  return {
    getState: () => ({ persistent: { mods: { game: mods } } }),
    showDialog: jest.fn().mockResolvedValue({ action, input }),
    store: {},
  } as any;
}

describe("collection multi-select actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("adds the selected mods to every checked editable collection and skips existing rules", async () => {
    const mods = {
      modA: makeMod("modA"),
      modB: makeMod("modB"),
      "collection-one": makeMod("collection-one"),
      "collection-two": makeMod("collection-two", [{ reference: { id: "modA" } }]),
      "collection-locked": makeMod("collection-locked", [], false),
    };
    const api = makeApi(mods, "Add", {
      "collection-one": true,
      "collection-two": true,
      "collection-locked": true,
    });

    await addCollectionAction(api, ["modA", "modB"]);

    const [dialogContent] = api.showDialog.mock.calls[0].slice(2);
    expect(dialogContent.checkboxes.map((choice) => choice.id)).toEqual([
      "collection-one",
      "collection-two",
    ]);
    expect(dialogContent.choices).toBeUndefined();
    expect(require("vortex-api").util.batchDispatch).toHaveBeenCalledWith(api.store, [
      expect.objectContaining({
        type: "ADD_MOD_RULE",
        collectionId: "collection-one",
        rule: expect.objectContaining({ reference: { id: "modA" } }),
      }),
      expect.objectContaining({
        type: "ADD_MOD_RULE",
        collectionId: "collection-one",
        rule: expect.objectContaining({ reference: { id: "modB" } }),
      }),
      expect.objectContaining({
        type: "ADD_MOD_RULE",
        collectionId: "collection-two",
        rule: expect.objectContaining({ reference: { id: "modB" } }),
      }),
    ]);
  });

  it("does not add rules when the add dialog is cancelled", async () => {
    const mods = {
      modA: makeMod("modA"),
      "collection-one": makeMod("collection-one"),
    };
    const api = makeApi(mods, "Cancel", { "collection-one": true });

    await addCollectionAction(api, ["modA"]);

    expect(require("vortex-api").util.batchDispatch).not.toHaveBeenCalled();
  });

  it("removes selected mods from every checked editable collection", async () => {
    const ruleA = { type: "requires", reference: { id: "modA" } };
    const ruleB = { type: "requires", reference: { id: "modB" } };
    const mods = {
      modA: makeMod("modA"),
      modB: makeMod("modB"),
      "collection-one": makeMod("collection-one", [ruleA, ruleB]),
      "collection-two": makeMod("collection-two", [ruleB]),
      "collection-locked": makeMod("collection-locked", [ruleA], false),
    };
    const api = makeApi(mods, "Remove", {
      "collection-one": true,
      "collection-two": true,
      "collection-locked": true,
    });

    await removeCollectionAction(api, ["modA", "modB"]);

    const [dialogContent] = api.showDialog.mock.calls[0].slice(2);
    expect(dialogContent.checkboxes.map((choice) => choice.id)).toEqual([
      "collection-one",
      "collection-two",
    ]);
    expect(dialogContent.choices).toBeUndefined();
    expect(require("vortex-api").util.batchDispatch).toHaveBeenCalledWith(api.store, [
      { type: "REMOVE_MOD_RULE", gameId: "game", collectionId: "collection-one", rule: ruleA },
      { type: "REMOVE_MOD_RULE", gameId: "game", collectionId: "collection-one", rule: ruleB },
      { type: "REMOVE_MOD_RULE", gameId: "game", collectionId: "collection-two", rule: ruleB },
    ]);
  });

  it("does not remove rules when the remove dialog is cancelled", async () => {
    const rule = { type: "requires", reference: { id: "modA" } };
    const mods = {
      modA: makeMod("modA"),
      "collection-one": makeMod("collection-one", [rule]),
    };
    const api = makeApi(mods, "Cancel", { "collection-one": true });

    await removeCollectionAction(api, ["modA"]);

    expect(require("vortex-api").util.batchDispatch).not.toHaveBeenCalled();
  });
});

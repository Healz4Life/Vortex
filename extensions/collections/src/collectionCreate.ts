/* eslint-disable */
import { MOD_TYPE } from './constants';
import { createCollectionFromProfile, showQuickCollectionRestrictionsDialog } from './util/transformCollection';

import * as Redux from 'redux';
import { actions, selectors, types, util } from 'vortex-api';

import { uploadCollection } from './util/util';

export async function initFromProfile(api: types.IExtensionApi, profileId?: string) {
  try {
    let forcedName: string;
    const isQuickCollection = profileId === undefined;
    if (isQuickCollection && selectors.activeProfile(api.getState()) === undefined) {
      // Should never happen - quick collection button shouldn't even appear if there's no active profile
      //  but lets just put this here.
      throw new util.ProcessCanceled('No active profile');
    }
    else if (isQuickCollection) {
      profileId = selectors.activeProfile(api.getState()).id;
      await showQuickCollectionRestrictionsDialog(api);
      forcedName = `My mods: ${new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}`;
    }

    const { id, name, updated, wantsToUpload } = await createCollectionFromProfile(api, profileId, forcedName);
    if (isQuickCollection) {
      const state = api.getState();
      const activeGameId = selectors.activeGameId(state);
      const mods: { [modId: string]: types.IMod } = util.getSafe(state, ['persistent', 'mods', activeGameId], {});
      const hasRules = (mods[id]?.rules ?? []).length > 0;
      if (!hasRules) {
        await api.showDialog('error', 'Collection is empty', {
          text: 'The generated quick collection is empty. Please ensure the Nexus Mods sourced mods you want to include are '
              + 'enabled and deployed.',
        }, [
          { label: 'Close' },
        ]);
        return;
      }
    }
    
    api.store.dispatch(actions.setModEnabled(profileId, id, true));
    if (wantsToUpload) {
      await uploadCollection(api, profileId, id);
    }
    api.sendNotification({
      type: 'success',
      id: 'collection-created',
      title: updated ? 'Collection updated' : 'Collection created',
      message: name,
      displayMS: util.calcDuration(name.length + 20),
      actions: [
        {
          title: 'Edit',
          action: dismiss => {
            api.events.emit('edit-collection', id);
            dismiss();
          },
        },
      ],
    });
  } catch (err) {
    if (!(err instanceof util.UserCanceled)) {
      throw err;
    }
  }
}

const collections = (mods: { [modId: string]: types.IMod }) => {
  const isWorkshopCollection = mod => (mod.type === MOD_TYPE)
          && (mod.attributes?.editable === true);
  return Object.values(mods)
    .filter(isWorkshopCollection)
    .map(coll => new Set((coll.rules ?? []).map(rule => rule.reference.id)));
};

export function addCollectionCondition(api: types.IExtensionApi, instanceIds: string[]) {
  const state = api.getState();
  const gameId = selectors.activeGameId(state);
  const mods = state.persistent.mods[gameId];

  return collections(mods).find(ruleSet => {
    // only offer the option if there is at least one mod not assigned to a collection
    return instanceIds.find(modId =>
      (mods[modId].type !== MOD_TYPE) && !ruleSet.has(modId)) !== undefined;
  }) !== undefined;
}

export function removeCollectionCondition(api: types.IExtensionApi, instanceIds: string[]) {
  const state = api.getState();
  const gameId = selectors.activeGameId(state);
  const mods = state.persistent.mods[gameId];
  return collections(mods).find(ruleSet => {
    // only offer the option if there is at least one mod assigned to a collection
    return instanceIds.find(modId => ruleSet.has(modId)) !== undefined;
  }) !== undefined;
}

export function alreadyIncluded(rules, modId): boolean {
  return rules?.find?.(rule => rule.reference.id === modId) !== undefined;
}

function selectedCollectionIds(input: { [id: string]: boolean }, collectionIds: string[]): string[] {
  return collectionIds.filter(collectionId => input[collectionId] === true);
}

export function addCollectionAction(api: types.IExtensionApi, instanceIdsIn: string[]) {
  const state = api.getState();
  const gameId = selectors.activeGameId(state);

  const mods = state.persistent.mods[gameId];

  // Not sure why this would happen but maybe if the table uses a cache
  const instanceIds = instanceIdsIn.filter(modId => mods[modId] !== undefined);

  const filtered = instanceIds.filter(modId => (mods[modId].type !== MOD_TYPE));

  const collectionIds = Object.keys(mods)
    .filter(collectionId => {
      if ((mods[collectionId].type !== MOD_TYPE)
          || (mods[collectionId].attributes?.editable !== true)) {
        return false;
      }

      const rules = mods[collectionId].rules ?? [];

      // only offer the option if there is at least one mod selected that is not
      // already in that collection
      return filtered.find(modId => !alreadyIncluded(rules, modId)) !== undefined;
    });

  const sortAlphabetically = (modIds: string[]) => {
    const temp = [...modIds];
    temp.sort((a, b) => {
      const modA = util.renderModName(mods[a]).toLowerCase();
      const modB = util.renderModName(mods[b]).toLowerCase();
      return modA.localeCompare(modB);
    });
    return temp;
  };
  return api.showDialog('question', 'Add Mods to Collection', {
    text: 'Choose which collections you want the selected mods to be added to',
    message: sortAlphabetically(filtered).map(modId =>
      util.renderModName(mods[modId], { version: true, variant: true })).join('\n'),
    checkboxes: sortAlphabetically(collectionIds).map((collectionId, idx) => ({
      id: collectionId,
      text: util.renderModName(mods[collectionId]),
      value: idx === 0,
    })),
  }, [
    { label: 'Cancel' },
    { label: 'Add' },
  ])
    .then((result: types.IDialogResult) => {
      if (result.action === 'Add') {
        const selectedIds = selectedCollectionIds(result.input, collectionIds);
        const addActions = selectedIds.reduce((prev: Redux.Action[], collectionId: string) => {
          const collection = mods[collectionId];
          if ((collection === undefined) || (collection.type !== MOD_TYPE)
              || (collection.attributes?.editable !== true)) {
            return prev;
          }

          const rules = collection.rules ?? [];
          filtered.forEach(modId => {
            if (!alreadyIncluded(rules, modId) && (mods[modId]?.type !== MOD_TYPE)) {
              prev.push(actions.addModRule(gameId, collectionId, {
                type: 'requires',
                reference: {
                  id: modId,
                },
              }));
            }
          });
          return prev;
        }, []);
        util.batchDispatch(api.store, addActions);
      }
    });
}

export function removeCollectionAction(api: types.IExtensionApi, instanceIds: string[]) {
  const state = api.getState();
  const gameId = selectors.activeGameId(state);
  const mods = state.persistent.mods[gameId];
  const validInstanceIds = instanceIds.filter(modId => mods[modId] !== undefined);
  const collectionIds = Object.keys(mods)
    .filter(collectionId => {
      if ((mods[collectionId].type !== MOD_TYPE)
          || (mods[collectionId].attributes?.editable !== true)) {
        return false;
      }

      const rules = mods[collectionId].rules ?? [];

      // only offer the option if there is at least one mod assigned to the collection
      return validInstanceIds.find(modId => alreadyIncluded(rules, modId)) !== undefined;
    });

  return api.showDialog('question', 'Remove Mods from Collection', {
    text: 'Select the collections to remove the selected mods from',
    message: validInstanceIds.map(modId => util.renderModName(mods[modId])).join('\n'),
    checkboxes: collectionIds.map((collectionId, idx) => ({
      id: collectionId,
      text: util.renderModName(mods[collectionId]),
      value: idx === 0,
    })),
  }, [
    { label: 'Cancel' },
    { label: 'Remove' },
  ])
    .then((result: types.IDialogResult) => {
      if (result.action === 'Remove') {
        const selectedIds = selectedCollectionIds(result.input, collectionIds);
        const removeActions = selectedIds.reduce((prev: Redux.Action[], collectionId: string) => {
          const collection = mods[collectionId];
          if ((collection === undefined) || (collection.type !== MOD_TYPE)
              || (collection.attributes?.editable !== true)) {
            return prev;
          }

          const rules = collection.rules ?? [];
          validInstanceIds.forEach(modId => {
            const ruleToRemove = rules.find(rule => rule.reference.id === modId);
            if (ruleToRemove !== undefined) {
              prev.push(actions.removeModRule(gameId, collectionId, ruleToRemove));
            }
          });
          return prev;
        }, []);
        util.batchDispatch(api.store, removeActions);
      }
    });
}

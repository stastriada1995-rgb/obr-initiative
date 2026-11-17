import OBR from "@owlbear-rodeo/sdk";
import { ID, ITEM_KEY, SKILLS_POPOVER, freshResources, asset } from "./constants.js";
import { startBars } from "./bars.js";

OBR.onReady(() => {
  // 1. Добавить / убрать из инициативы — только мастер
  OBR.contextMenu.create({
    id: `${ID}/context-menu`,
    icons: [
      {
        icon: asset("icon.svg"),
        label: "Добавить в инициативу",
        filter: {
          roles: ["GM"],
          every: [
            { key: "layer", value: "CHARACTER" },
            { key: ["metadata", ITEM_KEY], value: undefined },
          ],
        },
      },
      {
        icon: asset("icon.svg"),
        label: "Убрать из инициативы",
        filter: { roles: ["GM"], every: [{ key: "layer", value: "CHARACTER" }] },
      },
    ],
    onClick(context) {
      const addToTracker = context.items.every((item) => item.metadata[ITEM_KEY] === undefined);
      OBR.scene.items.updateItems(context.items, (items) => {
        for (const item of items) {
          if (addToTracker) {
            item.metadata[ITEM_KEY] = { initiative: null, conditions: [], ...freshResources() };
          } else {
            delete item.metadata[ITEM_KEY];
          }
        }
      });
    },
  });

  // 2. Окно персонажа: характеристики, защиты, ресурсы, навыки — только мастер
  OBR.contextMenu.create({
    id: `${ID}/skills-menu`,
    icons: [
      {
        icon: asset("skills.svg"),
        label: "Навыки персонажа",
        filter: { roles: ["GM"], max: 1, every: [{ key: "layer", value: "CHARACTER" }] },
      },
    ],
    async onClick(context, elementId) {
      const item = context.items[0];
      const [w, h] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
      OBR.popover.open({
        id: SKILLS_POPOVER,
        url: asset(`skills.html?item=${encodeURIComponent(item.id)}`),
        width: Math.min(720, Math.max(380, w - 120)),
        height: Math.min(820, Math.max(420, h - 80)),
        anchorElementId: elementId,
        anchorOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
        transformOrigin: { horizontal: "LEFT", vertical: "BOTTOM" },
      });
    },
  });

  // 3. Полоска хитов и КД над токенами
  startBars();
});

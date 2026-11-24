import { unrefElement } from "@vueuse/core";
import { useTemplateRef, type ComponentPublicInstance } from "vue";

/**
 * A dialog a page's "⋯" menu opened gives the focus back to that menu when it closes: the
 * dialog's own trigger is hidden where the menu shows. `menuRef` names the menu button's template
 * ref; pass `returnFocus` to the dialog's `close-auto-focus`. Where the menu is hidden (from `md`
 * up) the dialog's trigger takes the focus back as usual.
 */
export function useMenuFocusReturn(menuRef: string): {
  returnFocus: (event: Event) => void;
} {
  const menuButton = useTemplateRef<HTMLElement | ComponentPublicInstance>(
    menuRef
  );

  function returnFocus(event: Event): void {
    const button = unrefElement(menuButton);
    if (button instanceof HTMLElement && button.getClientRects().length > 0) {
      event.preventDefault();
      button.focus();
    }
  }

  return { returnFocus };
}

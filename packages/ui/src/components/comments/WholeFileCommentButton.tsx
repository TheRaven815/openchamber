import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * The header's trigger. It fades in with the header's hover, and stays visible
 * where nothing hovers (touch) and while the editor is open.
 */
export function WholeFileCommentButton({
  onClick,
  active,
  alwaysVisible = false,
  hoverGroupClass,
}: {
  onClick: () => void;
  active: boolean;
  alwaysVisible?: boolean;
  /** The `group-hover/...` variant of the header this sits in. */
  hoverGroupClass: string;
}) {
  const { t } = useI18n();
  const label = t('inlineComment.actions.commentOnFile');
  return (
    <button
      type="button"
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none',
        alwaysVisible || active ? 'opacity-100' : cn('opacity-0', hoverGroupClass),
        active && 'text-foreground',
      )}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Icon name="chat-1" className="size-3.5" />
    </button>
  );
}

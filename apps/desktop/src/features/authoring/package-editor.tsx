import type { EditableCapabilityPackage, EditableComponentType } from '@agentdoor/capability-kit';
import { addPackageComponent, removePackageComponent, updatePackageComponent } from '@agentdoor/capability-kit';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui';

const labels: Record<EditableComponentType, string> = {
  skill: 'Skill',
  prompt: 'Prompt',
  context: '项目上下文',
};

export function PackageEditor({
  editable,
  onChange,
}: {
  editable: EditableCapabilityPackage;
  onChange: (next: EditableCapabilityPackage) => void;
}) {
  const present = new Set(editable.components.map((component) => component.type));
  return (
    <section className="package-editor">
      <div className="package-editor__toolbar">
        {(['skill', 'prompt', 'context'] as const).map((type) => (
          <Button
            variant="secondary"
            key={type}
            disabled={present.has(type)}
            onClick={() => onChange(addPackageComponent(editable, type))}
          >
            <Plus aria-hidden size={14} />
            添加{labels[type]}
          </Button>
        ))}
      </div>
      {editable.components.map((component) => (
        <article className="package-component" key={component.id}>
          <header>
            <div>
              <strong>{labels[component.type]}</strong>
              <code>{component.path}</code>
            </div>
            {editable.components.length > 1 ? (
              <button
                type="button"
                aria-label={`删除${labels[component.type]}`}
                onClick={() => onChange(removePackageComponent(editable, component.id))}
              >
                <Trash2 aria-hidden size={15} />
              </button>
            ) : null}
          </header>
          <label>
            {labels[component.type]} 内容
            <textarea
              aria-label={`${labels[component.type]} 内容`}
              spellCheck={false}
              value={component.content}
              onChange={(event) =>
                onChange(updatePackageComponent(editable, component.id, { content: event.target.value }))
              }
              placeholder={`使用 Markdown 编写${labels[component.type]}内容`}
            />
          </label>
        </article>
      ))}
    </section>
  );
}

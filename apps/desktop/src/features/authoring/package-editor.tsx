import type { EditableCapabilityPackage, EditableComponentType } from '@capaport/capability-kit';
import {
  addPackageComponent,
  compatibleAgentsForComponents,
  removePackageComponent,
  updatePackageComponent,
} from '@capaport/capability-kit';
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
  function addCompatibleComponent(type: EditableComponentType) {
    const next = addPackageComponent(editable, type);
    const compatible = compatibleAgentsForComponents(next.components.map((component) => component.type));
    const retained = next.agents.filter((agent) => compatible.includes(agent));
    onChange({ ...next, agents: retained.length ? retained : compatible.slice(0, 1) });
  }
  return (
    <section className="package-editor">
      <div className="package-editor__toolbar">
        {(['skill', 'prompt', 'context'] as const).map((type) => (
          <Button
            variant="secondary"
            key={type}
            disabled={present.has(type)}
            onClick={() => addCompatibleComponent(type)}
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

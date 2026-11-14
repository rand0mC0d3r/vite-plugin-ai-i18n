import { useState } from "react";

function DocumentToolbar({ onSave, onSaveAs, onCancel }: { onSave: () => void; onSaveAs: () => void; onCancel: () => void }) {
  return <header className="toolbar">
    <button onClick={onSave} title="Save the current document">Save</button>
    <button onClick={onSaveAs} title="Save a copy under another name">Save as...</button>
    <button onClick={onCancel}>Cancel</button>
  </header>;
}

function FilterPanel({ onSave }: { onSave: () => void }) {
  return <aside>
    <h2>Filters and pets and household items, cows, bears, bees</h2>
    <label>Document name <input placeholder="Search documents" /></label>
    <button onClick={onSave} aria-label="Save these filter settings">Save</button>
  </aside>;
}

function DeleteDialog({ count, onClose, onDelete }: { count: number; onClose: () => void; onDelete: () => void }) {
  return <section role="dialog" aria-modal="true" aria-label="Delete documents">
    <p>Are you sure you want to delete {count} selected documents?</p>
    <h2>Delete documents</h2>
    <p>This action cannot be undone.</p>
    <button id="cancel-button" onClick={onClose}>Cancel</button>
    <button onClick={onDelete} title="Permanently delete selected documents">Delete</button>
  </section>;
}

interface DocumentItem {
  id: number;
  name: string;
  pages: number;
  status: string;
}

// Called during render: runtime-delivered strings are looked up when evaluated, so a module-level constant would keep the import-time locale.
const createDocuments = (): DocumentItem[] => [
  { id: 1, name: /* i18n */ "Quarterly report.pdf", pages: 12, status: /* i18n */ "Shared with your team" },
  { id: 2, name: /* i18n */ "Onboarding checklist.docx", pages: 3, status: /* i18n */ "Private" },
  { id: 3, name: /* i18n */ "Budget 2027.xlsx", pages: 1, status: /* i18n */ "Shared with your team" },
];

const Button = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>;

function DocumentList({ items }: { items: DocumentItem[] }) {
  return <section aria-label="Document list">
    <h2>Recent documents</h2>
    <Button>New Images</Button>
    <button>New Document</button>
    <ul>
      {items.map(doc => <li key={doc.id}>
        <strong>{doc.name}</strong>{" "}
        <span>{doc.pages} pages</span>{" "}
        <em>{doc.status}</em>
      </li>)}
    </ul>
  </section>;
}

export function DocumentDashboard() {
  const [selected, setSelected] = useState(3);
  const [saved, setSaved] = useState(false);
  return <main>
    <h1>Document library</h1>
    <h1>Files for every occasion selected</h1>
    <h2>Sample code for people and animals</h2>
    <p>You have {selected} documents selected.</p>
    <DocumentToolbar onSave={() => setSaved(true)} onSaveAs={() => setSaved(true)} onCancel={() => setSelected(0)} />
    <FilterPanel onSave={() => setSaved(true)} />
    <DocumentList items={createDocuments()} />
    {saved && <p role="status">Changes saved successfully.</p>}
    <DeleteDialog count={selected} onClose={() => setSelected(0)} onDelete={() => setSelected(0)} />
  </main>;
}

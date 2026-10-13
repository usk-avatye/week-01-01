export function textElement<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag);
    node.textContent = text;
    node.className = className;
    return node;
}
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => textElement(document, tag, text, className);
export const money = (amount: number) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(amount);
export const time = (date: string | null) => date ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(date)) : '—';
export function button(label: string, action: () => void | Promise<void>, className = 'button'): HTMLButtonElement {
    const node = el('button', label, className);
    node.type = 'button';
    node.addEventListener('click', () => { void action(); });
    return node;
}
export function link(label: string, hash: string, className = ''): HTMLAnchorElement {
    const node = el('a', label, className);
    node.href = hash;
    return node;
}
export function field(label: string, input: HTMLInputElement): HTMLLabelElement {
    const node = el('label', '', 'field');
    node.append(el('span', label), input);
    return node;
}
export function input(type = 'text', name = ''): HTMLInputElement {
    const node = el('input');
    node.type = type;
    node.name = name;
    node.required = true;
    return node;
}
export function amountInput(name: string, value?: number): HTMLInputElement {
    const node = input('number', name);
    node.min = '1';
    node.max = '1000000000';
    node.step = '1';
    if (value !== undefined)
        node.value = String(value);
    return node;
}
export function message(node: HTMLElement, text: string, error = false): void {
    node.textContent = text;
    node.className = `message${error ? ' error' : ''}`;
    node.setAttribute('role', error ? 'alert' : 'status');
}
export const errorText = (error: unknown) => error instanceof Error ? error.message : '요청을 완료하지 못했습니다. 다시 확인해 주세요.';

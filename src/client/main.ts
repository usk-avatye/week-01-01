import type { AuthDto } from '../contracts/auth.js';
import { createApi, ClientError } from './api.js';
import { authPage } from './auth-page.js';
import { campaignList } from './campaign-list.js';
import { campaignDetail } from './campaign-detail.js';
import { layout } from './layout.js';
import { el, errorText, message } from './dom.js';
const root = document.querySelector<HTMLElement>('#app')!;
let current = new AbortController();
async function navigate(): Promise<void> {
    current.abort();
    const controller = new AbortController();
    current = controller;
    const route = location.hash.slice(1) || '/campaigns', api = createApi('', controller.signal);
    if (route === '/admin/login') {
        location.hash = '#/login';
        return;
    }
    if (['/login', '/signup'].includes(route)) {
        const host = layout(root, '');
        authPage(host, api, route === '/signup' ? 'signup' : 'login');
        return;
    }
    root.replaceChildren(el('p', '불러오는 중', 'loading'));
    try {
        const auth = await api.request<AuthDto>('GET', '/auth/me');
        if (controller.signal.aborted)
            return;
        const admin = auth.member.role === 'ADMIN', base = admin ? '/admin/campaigns' : '/campaigns';
        if (!route.startsWith(base) || (route !== base && !new RegExp(`^${base}/[1-9]\\d{0,18}$`).test(route))) {
            location.hash = '#' + base;
            return;
        }
        const context = { member: auth.member, api: createApi(auth.csrfToken, controller.signal), signal: controller.signal };
        const host = layout(root, route === base ? (admin ? '전체 캠페인' : '내 캠페인') : '', context);
        if (route === base)
            await campaignList(host, context, admin);
        else
            await campaignDetail(host, context, route.slice(base.length + 1), admin);
    }
    catch (error) {
        if (controller.signal.aborted)
            return;
        if (error instanceof ClientError && error.status === 401) {
            location.hash = '#/login';
            return;
        }
        const host = layout(root, '화면을 불러오지 못했습니다.');
        const notice = el('p');
        message(notice, errorText(error), true);
        host.append(notice);
    }
}
window.addEventListener('hashchange', () => { void navigate(); });
void navigate();

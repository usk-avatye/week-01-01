import type { AuthDto } from '../contracts/auth.js';
import type { Api } from './api.js';
import { button, el, errorText, field, input, link, message } from './dom.js';
export function authPage(host: HTMLElement, api: Api, mode: 'signup' | 'advertiser' | 'admin'): void {
    const signup = mode === 'signup', form = el('form', '', 'card auth-card');
    const email = input('email', 'email');
    email.autocomplete = 'username';
    email.maxLength = 254;
    const password = input('password', 'password');
    password.autocomplete = signup ? 'new-password' : 'current-password';
    password.minLength = 15;
    const name = input('text', 'displayName');
    name.maxLength = 100;
    name.autocomplete = 'name';
    form.append(el('h1', signup ? '회원가입' : mode === 'admin' ? '관리자 로그인' : '광고주 로그인'));
    if (signup)
        form.append(field('이름', name));
    form.append(field('이메일', email), field('비밀번호', password));
    if (signup) form.append(el('p', '비밀번호는 15~128자입니다.', 'muted'));
    const notice = el('p', '', 'message'), submit = button(signup ? '가입하기' : '로그인', () => { });
    submit.type = 'submit';
    form.append(submit, notice);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        message(notice, '처리 중입니다.');
        try {
            if (signup) {
                await api.request('POST', '/auth/signup', { email: email.value, password: password.value, displayName: name.value });
                message(notice, '가입되었습니다. 로그인 화면으로 이동합니다.');
                location.hash = '#/login';
            }
            else {
                const auth = await api.request<AuthDto>('POST', '/auth/login', { email: email.value, password: password.value, portal: mode });
                location.hash = auth.member.role === 'ADMIN' ? '#/admin/campaigns' : '#/campaigns';
            }
        }
        catch (error) {
            message(notice, errorText(error), true);
        }
        finally {
            submit.disabled = false;
        }
    });
    const links = el('nav', '', 'auth-links');
    if (mode !== 'advertiser') links.append(link('광고주 로그인', '#/login'));
    if (mode === 'advertiser') links.append(link('회원가입', '#/signup'), link('관리자 로그인', '#/admin/login'));
    host.append(form, links);
}

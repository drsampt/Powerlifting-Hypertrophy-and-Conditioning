const AuthState = { account: null, mode: 'login' };

function onAuthExpired() {
  AuthState.account = null;
  renderAuthGate();
}

function renderAuthGate() {
  const gate = document.getElementById('auth-gate');
  const app = document.getElementById('app');
  if (AuthState.account) {
    gate.style.display = 'none';
    app.style.display = '';
    return;
  }
  app.style.display = 'none';
  gate.style.display = 'flex';

  const isLogin = AuthState.mode === 'login';
  gate.innerHTML = `
    <div class="card" style="max-width:360px;width:100%">
      <h1 style="margin-top:0">Training Program Builder</h1>
      <p class="subtitle">${isLogin ? 'Log in to your account.' : 'Create an account.'} Every athlete's programs are private to their own login.</p>
      <form id="auth-form">
        ${isLogin ? '' : `<div class="field"><label>Your Name</label><input name="name" placeholder="e.g. Dr. Sam" /></div>`}
        <div class="field"><label>Email</label><input name="email" type="email" required /></div>
        <div class="field"><label>Password</label><input name="password" type="password" required minlength="8" /></div>
        <button type="submit" class="btn" style="width:100%">${isLogin ? 'Log In' : 'Sign Up'}</button>
      </form>
      <p class="help" style="margin-top:14px">
        ${isLogin ? "Don't have an account?" : 'Already have an account?'}
        <a href="#" id="auth-switch">${isLogin ? 'Sign up' : 'Log in'}</a>
      </p>
    </div>
  `;

  document.getElementById('auth-switch').addEventListener('click', (e) => {
    e.preventDefault();
    AuthState.mode = isLogin ? 'signup' : 'login';
    renderAuthGate();
  });

  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    const submitBtn = e.target.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    try {
      const result = isLogin ? await Api.login(data) : await Api.signup(data);
      localStorage.setItem('tpb_token', result.token);
      AuthState.account = result.account;
      renderAuthGate();
      render();
    } catch (err) {
      toast(`Error: ${err.message}`);
      submitBtn.disabled = false;
    }
  });
}

async function initAuth() {
  if (!Api.isLoggedIn()) {
    renderAuthGate();
    return;
  }
  try {
    const { account } = await Api.me();
    AuthState.account = account;
  } catch (e) {
    AuthState.account = null;
  }
  renderAuthGate();
  if (AuthState.account) render();
}

async function logOut() {
  try { await Api.logout(); } catch (e) {}
  localStorage.removeItem('tpb_token');
  AuthState.account = null;
  State.program = null;
  State.programsList = [];
  renderAuthGate();
}

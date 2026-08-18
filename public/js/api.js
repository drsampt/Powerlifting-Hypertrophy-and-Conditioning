const Api = (() => {
  function getToken() {
    return localStorage.getItem('tpb_token');
  }

  async function req(method, url, body) {
    const opts = { method, headers: {} };
    const token = getToken();
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (res.status === 401) {
      localStorage.removeItem('tpb_token');
      if (typeof onAuthExpired === 'function') onAuthExpired();
    }
    if (!res.ok) {
      let msg = `Request failed: ${res.status}`;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return res.json();
    return res.text();
  }

  return {
    get: (url) => req('GET', url),
    post: (url, body) => req('POST', url, body),
    put: (url, body) => req('PUT', url, body),
    del: (url) => req('DELETE', url),

    isLoggedIn: () => !!getToken(),
    signup: (data) => req('POST', '/api/auth/signup', data),
    login: (data) => req('POST', '/api/auth/login', data),
    logout: () => req('POST', '/api/auth/logout'),
    me: () => req('GET', '/api/auth/me'),

    createProfile: (data) => req('POST', '/api/profile', data),
    getProfile: (id) => req('GET', `/api/profile/${id}`),
    generateProgram: (profile_id) => req('POST', '/api/generate-program', { profile_id }),
    getProgram: (id) => req('GET', `/api/program/${id}`),
    updateProgram: (id, data) => req('PUT', `/api/program/${id}`, data),
    deleteProgram: (id) => req('DELETE', `/api/program/${id}`),
    listPrograms: () => req('GET', '/api/programs'),
    archiveProgram: (id) => req('POST', `/api/program/${id}/archive`),
    cloneProgram: (id) => req('POST', `/api/program/${id}/clone`),

    logSession: (data) => req('POST', '/api/log-session', data),
    getSessions: (programId) => req('GET', `/api/sessions/${programId}`),
    updateSession: (id, data) => req('PUT', `/api/session/${id}`, data),

    getProgress: (programId) => req('GET', `/api/progress/${programId}`),
    compareWeeks: (programId, w1, w2) => req('GET', `/api/compare/${programId}?week1=${w1}&week2=${w2}`),

    getExercises: (sport) => req('GET', `/api/exercises${sport ? `?sport=${encodeURIComponent(sport)}` : ''}`),
    getVariations: (exercise) => req('GET', `/api/exercise-variations/${encodeURIComponent(exercise)}`)
  };
})();

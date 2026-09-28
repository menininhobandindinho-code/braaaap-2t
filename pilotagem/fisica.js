// Física de pilotagem do protótipo (plano, vista de cima). Módulo puro: sem DOM, testável no Node.
// Base na pesquisa docs/pesquisa/PILOTAGEM-REAL.md (códigos S1…S29 nos comentários):
//  - gás e direção são entradas separadas: sem gás a moto não anda (pedido do humano);
//  - pouco gás deitado segura a frente, muito gás faz a traseira patinar e derrapar (S1);
//  - na derrapagem a roda da frente contraesterça sozinha (S1, S5);
//  - freio traseiro com a moto deitada fecha a curva (S1, S5); dianteiro demais faz a frente escapar (S3);
//  - aderência cai e volta aos poucos (curva de pneu contínua, sem interruptor);
//  - terra solta patina mais, terra batida aguenta mais gás (S16, S17);
//  - motor segura a moto com o gás fechado ("embreagem solta", S4).
// Unidades SI. Eixos do corpo: x para a frente, y para a esquerda, guinada positiva anti-horária.

export const G = 9.81;

export const SUPERFICIES = {
  // mu: atrito; kp: patinagem de pico; ap: ângulo de pico (rad); deslize: sobra de aderência
  // deslizando; lateralMin: aderência lateral que resta com a roda patinando; soltura: quanta
  // terra sai; crr: resistência ao rolamento
  batida: { mu: 1.05, kp: 0.12, ap: 0.14, deslize: 0.78, lateralMin: 0.50, soltura: 0.45, crr: 0.020, nome: 'terra batida' },
  // Calibração arcade: preserva apoio lateral mesmo com gás cheio. A menor
  // aderência geral e a patinagem continuam, mas curva moderada não vira rodopio.
  solta:  { mu: 0.80, kp: 0.16, ap: 0.17, deslize: 0.70, lateralMin: 0.70, soltura: 1.00, crr: 0.035, nome: 'terra solta' },
  areia:  { mu: 0.66, kp: 0.22, ap: 0.21, deslize: 0.74, lateralMin: 0.45, soltura: 1.35, crr: 0.080, nome: 'areia' },
  capim:  { mu: 0.60, kp: 0.10, ap: 0.12, deslize: 0.60, lateralMin: 0.35, soltura: 0.25, crr: 0.045, nome: 'capim seco' },
};

export const PARAMETROS = {
  massa: 165,            // moto 125 2T + piloto
  entreEixos: 1.46,      // medida da moto nossa
  cgFrente: 0.78,        // do centro de massa ao eixo da frente
  cgAltura: 0.85,
  inerciaGuinada: 55,
  raioF: 0.347, raioT: 0.339,
  inerciaRodaF: 0.6, inerciaRodaT: 1.0,   // traseira inclui a transmissão
  potencia: 26000,       // ~35 cv
  torqueMax: 520,        // na roda, N·m (acima disso empina sozinha; o wheelie vem da alavanca, como no MTX)
  freioMotor: 1.2,       // N·m·s com gás fechado
  freioMaxF: 900, freioMaxT: 450,          // N·m
  cdA: 0.6,
  // direção
  esterçoLento: 0.62, esterçoRapido: 0.11, // rad, conforme a velocidade
  velEsterçoRapido: 18,                    // m/s
  taxaEsterço: 3.2,                        // rad/s
  contraguidao: 1.0,     // quanto a frente se alinha sozinha com a derrapagem da traseira (S1)
  contraguidaoMax: 0.6,  // rad
  // suspensão (só sinais para a animação)
  cursoF: 0.30, cursoT: 0.30, sagF: 0.28, sagT: 0.33,
  rigidezF: 12500, rigidezT: 14000,
  freqF: 2.0, freqT: 1.7, amortecimento: 0.45,
  // divisão do freio único (LT/L2) entre frente e traseira; proposta ajustável.
  // Semics (S5) manda maximizar o traseiro; MXA (S20) diz que a frente faz 70%.
  divisaoFreio: 0.5,     // fração para a frente
  // dosagem do piloto (0 desliga, 1 liga): na freada o peso vai para a frente e a roda de trás fica leve; o piloto
  // alivia o pé para ela não gastar toda a aderência e deixar a traseira sem apoio lateral (a moto rodava com 20% de
  // freio e um pouco de direção). Limita a força de frenagem de cada roda a uma fração do que o pneu aguenta, menos
  // o que a curva já está usando. O que sobra da traseira passa para a frente. O jogo liga; o laboratório mede cru.
  dosagemFreio: 0,
  dosagemT: 0.75, dosagemF: 0.95,   // fração da aderência que cada freio pode usar com a moto reta
  // estabilidade de guinada (1/s; 0 desliga): o modelo plano não tem a inclinação nem o giroscópio das rodas, que numa
  // moto de verdade prendem a guinada ao esterço. Sem isso, com o peso na frente (freio ou gás fechado) a traseira
  // passa a frente e a moto roda. Puxa a guinada para a do esterço (u·tan(esterço)/L) com o gás fechado e some com
  // o gás aberto, para o powerslide continuar vindo do gás. O jogo liga; o laboratório mede cru.
  estabilidadeGuinada: 0,
  // vertical (costelas e saltos, estilo MTX: alavanca para baixo carrega, golpe para cima solta)
  inerciaArfagem: 45,
  amortVertical: 1.0,   // calibrado nas costelas (27/09): 0,5 deixava a arfagem chegar a ~75° entre ondas (nariz batendo); 1,0 desce a ~40°
  preloadForca: 0.45,     // fração do peso empurrada para baixo ao carregar
  preloadImpulso: 2.8,    // m/s de impulso vertical com a carga cheia
  corpoTorqueChao: 90, corpoTorqueAr: 140,   // N·m da alavanca para cima/baixo
  arRigidez: 500, arAmort: 120,   // no ar o piloto (automático) alinha a moto com o chão do pouso
  wheelieAlvo: 0.45, wheelieRigidez: 2500, wheelieAmort: 300,   // equilíbrio automático do wheelie (o piloto dosa sozinho)
  deslocaPostura: 0.25, deslocaCorpo: 0.18,  // m que o centro de massa anda com a postura e com a alavanca
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const suave = (atual, alvo, dt, tau) => atual + (alvo - atual) * (1 - Math.exp(-dt / Math.max(1e-6, tau)));

// curva de pneu normalizada: sobe até 1 no pico (s = 1) e cai devagar até a sobra de deslize
export function curvaPneu(s, deslize) {
  if (s <= 1) return s * (2 - s);
  return deslize + (1 - deslize) * Math.exp(-(s - 1) * 1.5);
}

// força do pneu por patinagem (kappa) e ângulo (alfa), no referencial da roda.
// Longitudinal e lateral saem cada uma da sua curva; a patinagem (ou o travamento) tira
// aderência lateral aos poucos, até um mínimo: é isso que deixa a derrapagem dosável no gás.
// No fim, o círculo de atrito corta primeiro a força longitudinal (prioridade lateral).
export function forcaPneu(kappa, tanAlfa, carga, sup) {
  const kn = kappa / sup.kp, tn = tanAlfa / Math.tan(sup.ap);
  const s = Math.hypot(kn, tn);
  if (carga <= 0 || s < 1e-12) return { fx: 0, fy: 0, uso: 0, s, lateral: 1 };
  const muN = sup.mu * carga;
  const fx0 = muN * curvaPneu(Math.abs(kn), sup.deslize) * Math.sign(kn);
  const fy0 = -muN * curvaPneu(Math.abs(tn), sup.deslize) * Math.sign(tn);
  const patina = clamp((Math.abs(kn) - 1) / 3, 0, 1);
  const lateral = 1 - (1 - sup.lateralMin) * patina;          // 1 → lateralMin com a roda patinando ou travada
  const fyMax = muN * lateral;
  const fy = clamp(fy0, -fyMax, fyMax);
  const fxMax = Math.sqrt(Math.max(0, muN * muN - fy * fy));
  const fx = clamp(fx0, -fxMax, fxMax);
  return { fx, fy, uso: Math.hypot(fx, fy) / muN, s, lateral };
}

export function criarMoto(opcoes = {}) {
  const p = { ...PARAMETROS, ...(opcoes.parametros || {}) };
  const L = p.entreEixos, a = p.cgFrente, b = L - a;
  return {
    p, a, b,
    x: opcoes.x || 0, y: opcoes.y || 0, rumo: opcoes.rumo || 0,
    u: opcoes.u || 0, v: 0, r: 0,
    wF: (opcoes.u || 0) / p.raioF, wT: (opcoes.u || 0) / p.raioT,
    esterçoJogador: 0, esterço: 0, contraguidao: 0,
    gas: 0, freioF: 0, freioT: 0,
    ax: 0, ay: 0, inclinacao: 0,
    cargaF: p.massa * G * b / L, cargaT: p.massa * G * a / L,
    zF: p.sagF * p.cursoF, vzF: 0, zT: p.sagT * p.cursoT, vzT: 0,
    pesoLong: 0, pesoLat: 0, emPe: 0, peFora: 0,
    patinagem: 0, deriva: 0, usoT: 0, usoF: 0,
    velPatinagemT: 0, velLateralT: 0,
    noChao: true, traseiraNoChao: true, frenteNoChao: true,
    // vertical: centro de massa, arfagem (+ nariz para cima), molas da frente e de trás
    z: p.cgAltura + (opcoes.alturaChao ? opcoes.alturaChao(opcoes.x || 0, opcoes.y || 0) : 0),
    vz: 0, th: 0, wth: 0, dcF: 0, dcT: 0,
    forcaF: p.massa * G * b / L, forcaT: p.massa * G * a / L,
    preload: 0, tempoDesdeBaixo: 99, tempoNoAr: 0, queda: 0, quedas: 0, caiu: false,
    alturaChao: opcoes.alturaChao || (() => 0),
    tempo: 0,
  };
}

// uma etapa de integração. entrada = { gas 0..1, freio 0..1 (único) ou freioF/freioT, direcao -1..1 }
export function passo(m, entrada, sup, dt) {
  // A demo consome este evento entre quadros. Não retomar a física nos
  // subpassos restantes com o chassi ainda na pose afundada do tombo.
  if (m.caiu) return m;
  const p = m.p, L = p.entreEixos, a = m.a, b = m.b;
  // ---- entradas
  m.gas = clamp(entrada.gas || 0, 0, 1);
  if (entrada.freioF !== undefined || entrada.freioT !== undefined) {
    m.freioF = clamp(entrada.freioF || 0, 0, 1); m.freioT = clamp(entrada.freioT || 0, 0, 1);
  } else {
    const f = clamp(entrada.freio || 0, 0, 1), d = clamp(p.divisaoFreio, 0, 1);
    m.freioF = f * Math.min(1, d * 2); m.freioT = f * Math.min(1, (1 - d) * 2);
  }
  const dir = clamp(entrada.direcao || 0, -1, 1);
  // ---- direção: o jogador aponta; o limite cai com a velocidade (em velocidade a moto curva deitando)
  // em velocidade a moto esterça pouco: o limite acompanha o que o pneu aguenta (1,25× a
  // aderência) mais o ângulo de deriva de que o pneu da frente precisa para fazer força
  const vel = Math.abs(m.u);
  const maxEst = Math.min(p.esterçoLento, 1.25 * sup.mu * G * L / Math.max(vel, 1) ** 2 + 0.8 * sup.ap);
  const alvo = -dir * maxEst;   // direita no controle = esterço negativo (y é para a esquerda)
  const passoMax = p.taxaEsterço * dt;
  m.esterçoJogador += clamp(alvo - m.esterçoJogador, -passoMax, passoMax);
  // contraguidão: a frente se alinha com a derrapagem da traseira (S1: powerslide faz a frente contraesterçar)
  // (só a parte que passa do ângulo de pico: numa curva sem derrapagem não há contraguidão)
  const uMin = Math.max(Math.abs(m.u), 2.0);
  const betaT = Math.atan2(m.v - b * m.r, uMin);
  const excesso = Math.sign(betaT) * Math.max(0, Math.abs(betaT) - 0.6 * sup.ap);
  const alvoCG = clamp(p.contraguidao * excesso * clamp(vel / 3, 0, 1), -p.contraguidaoMax, p.contraguidaoMax);
  m.contraguidao = suave(m.contraguidao, alvoCG, dt, 0.06);
  m.esterço = clamp(m.esterçoJogador + m.contraguidao, -0.75, 0.75);
  // ---- queda: sem comando por um tempo, a moto arrasta até parar
  if (m.queda > 0) {
    m.queda -= dt; m.gas = 0; m.freioF = m.freioT = 1; m.esterçoJogador *= 0.9;
    m.u *= Math.exp(-2.5 * dt); m.v *= Math.exp(-4 * dt); m.r *= Math.exp(-4 * dt);
    if (m.queda <= 0) { m.queda = 0; m.caiu = true; return m; }
  }
  // ---- cargas nas rodas: força das molas (vertical) do passo anterior
  m.cargaF = m.forcaF; m.cargaT = m.forcaT;
  const cr0 = Math.cos(m.rumo), sr0 = Math.sin(m.rumo);
  const gF = m.alturaChao(m.x + cr0 * a, m.y + sr0 * a), gT = m.alturaChao(m.x - cr0 * b, m.y - sr0 * b);
  const rampa = (gF - gT) / L;                                  // inclinação ao longo do rumo
  // ---- pneus
  const uS = uMin * Math.sign(m.u || 1);
  const vF = m.v + a * m.r, vT = m.v - b * m.r;
  const c = Math.cos(m.esterço), s = Math.sin(m.esterço);
  // velocidade do contato da frente no referencial da roda
  const uFw = m.u * c + vF * s, vFw = -m.u * s + vF * c;
  const kF = (m.wF * p.raioF - uFw) / Math.max(Math.abs(uFw), 2.0);
  const tanAF = vFw / Math.max(Math.abs(uFw), 2.0);
  const kT = (m.wT * p.raioT - m.u) / Math.max(Math.abs(m.u), 2.0);
  const tanAT = vT / Math.max(Math.abs(m.u), 2.0);
  const pf = forcaPneu(kF, tanAF, m.cargaF, sup);
  const pt = forcaPneu(kT, tanAT, m.cargaT, sup);
  // ---- forças no corpo
  const fxF = pf.fx * c - pf.fy * s, fyF = pf.fx * s + pf.fy * c;
  const arrasto = 0.5 * 1.2 * p.cdA * m.u * Math.abs(m.u);
  const rolamento = sup.crr * p.massa * G * Math.tanh(m.u / 0.5) * (m.noChao ? 1 : 0);
  const fx = fxF + pt.fx - arrasto - rolamento;
  const fy = fyF + pt.fy;
  const du = fx / p.massa + m.v * m.r - (m.noChao ? G * Math.sin(Math.atan(rampa)) : 0);
  const dv = fy / p.massa - m.u * m.r;
  let dr = (a * fyF - b * pt.fy) / p.inerciaGuinada;
  if (p.estabilidadeGuinada > 0 && m.noChao && vel > 2) {
    const rKin = m.u * Math.tan(m.esterço) / L, peso = clamp(1 - m.gas / 0.6, 0, 1);
    dr += -p.estabilidadeGuinada * peso * (m.r - rKin);
  }
  // ---- rodas: motor, freio-motor, freios
  const wT = Math.max(Math.abs(m.wT), 10);
  // limitador de giro (a marcha limita quanto a roda pode girar além do chão)
  const vLim = Math.max(9, 1.5 * Math.abs(m.u) + 4);
  const corte = clamp((vLim - m.wT * p.raioT) / 1.5, 0, 1);
  const faixa = 0.55 + 0.45 * clamp(Math.abs(m.u) / 6, 0, 1);
  const torqueMotor = m.gas * Math.min(p.torqueMax * faixa, p.potencia / wT) * corte;
  let freioMotor = (1 - m.gas) * p.freioMotor * m.wT;
  let tBT = m.freioT * p.freioMaxT * Math.tanh(m.wT / 0.5);
  let tBF = m.freioF * p.freioMaxF * Math.tanh(m.wF / 0.5);
  if (p.dosagemFreio > 0 && m.noChao) {
    // quanto cada pneu ainda aguenta de frenagem depois do que a curva usa (círculo de atrito)
    const livre = (pn, carga, k) => {
      const muN = sup.mu * Math.max(0, carga), lat = muN > 1 ? Math.min(1, Math.abs(pn.fy) / muN) : 1;
      return k * muN * Math.sqrt(Math.max(0, 1 - lat * lat));
    };
    const capT = livre(pt, m.cargaT, p.dosagemT) * p.raioT, capF = livre(pf, m.cargaF, p.dosagemF) * p.raioF;
    const retT = tBT + Math.max(0, freioMotor), sobraT = Math.max(0, retT - capT) * p.dosagemFreio;
    if (sobraT > 0) {
      const k = (retT - sobraT) / retT; tBT *= k; if (freioMotor > 0) freioMotor *= k;
      if (m.freioF > 0.01 || m.freioT > 0.01) tBF += sobraT * p.raioF / p.raioT;   // o piloto passa o que tirou de trás para a frente
    }
    if (tBF > capF) tBF -= (tBF - capF) * p.dosagemFreio;
  }
  // rodas integradas de forma semi-implícita (a força do pneu reage rápido ao giro da roda)
  const eps = 1e-4;
  const dFxT = (forcaPneu(kT + eps, tanAT, m.cargaT, sup).fx - pt.fx) / eps;
  const dFxF = (forcaPneu(kF + eps, tanAF, m.cargaF, sup).fx - pf.fx) / eps;
  const rigT = Math.max(0, dFxT) * p.raioT / Math.max(Math.abs(m.u), 2.0) * p.raioT;
  const rigF = Math.max(0, dFxF) * p.raioF / Math.max(Math.abs(uFw), 2.0) * p.raioF;
  // ---- integra (Euler semi-implícito)
  m.u += du * dt; m.v += dv * dt; m.r += dr * dt;
  const wTantes = m.wT, wFantes = m.wF;
  m.wT += dt * (torqueMotor - freioMotor - tBT - pt.fx * p.raioT) / (p.inerciaRodaT + dt * rigT);
  m.wF += dt * (-tBF - pf.fx * p.raioF) / (p.inerciaRodaF + dt * rigF);
  const dwTdt = (m.wT - wTantes) / dt;
  // freio não inverte a roda: trava em zero
  if (wTantes > 0 && m.wT < 0 && m.gas < 0.01) m.wT = 0;
  if (wFantes > 0 && m.wF < 0) m.wF = 0;
  // parada: sem gás e quase parada, a moto fica quieta (nada de andar sozinha)
  if (m.gas < 0.01 && Math.abs(m.u) < 0.05 && Math.abs(m.v) < 0.05) { m.u = 0; m.v = 0; m.r *= 0.5; if (Math.abs(m.wT * p.raioT) < 0.05) m.wT = 0; if (Math.abs(m.wF * p.raioF) < 0.05) m.wF = 0; }
  // posição no mundo
  const cr = Math.cos(m.rumo), sr = Math.sin(m.rumo);
  m.x += (m.u * cr - m.v * sr) * dt;
  m.y += (m.u * sr + m.v * cr) * dt;
  m.rumo += m.r * dt;
  m.ax = suave(m.ax, du - m.v * m.r, dt, 0.05);
  m.ay = suave(m.ay, dv + m.u * m.r, dt, 0.08);
  m.tempo += dt;
  // ---- estado de leitura
  m.velPatinagemT = m.wT * p.raioT - m.u;           // >0 roda girando mais que o chão
  m.velLateralT = vT;
  m.patinagem = clamp(Math.abs(kT) / (sup.kp * 3), 0, 1);
  m.deriva = Math.atan2(m.v, Math.max(Math.abs(m.u), 0.5));
  m.usoT = pt.uso; m.usoF = pf.uso;
  m.sT = pt.s; m.sF = pf.s;
  // inclinação da moto (visual): tan(fi) = ay / g
  m.inclinacao = suave(m.inclinacao, clamp(Math.atan2(m.ay, G), -0.95, 0.95), dt, 0.12);
  atualizaPiloto(m, dir, dt);
  atualizaVertical(m, entrada, dt, pt.fx + fxF, dwTdt, gF, gT);
  return m;
}

// ---- vertical: molas da frente e de trás, arfagem, voo, carga da suspensão (MTX) e queda
function atualizaVertical(m, entrada, dt, fxContato, dwTdt, gF, gT) {
  const p = m.p, L = p.entreEixos, a = m.a, b = m.b;
  const corpo = clamp(entrada.corpo || 0, -1, 1);      // +1 alavanca para cima (frente), -1 para baixo (trás)
  // molas: rigidez tal que em repouso a compressão é o "sag"
  const kF = p.massa * G * b / L / (p.sagF * p.cursoF), kT = p.massa * G * a / L / (p.sagT * p.cursoT);
  const mF = p.massa * b / L, mT = p.massa * a / L;
  const cdF = 2 * p.amortVertical * Math.sqrt(kF * mF), cdT = 2 * p.amortVertical * Math.sqrt(kT * mT);
  const DF = p.cgAltura - p.raioF + p.sagF * p.cursoF, DT = p.cgAltura - p.raioT + p.sagT * p.cursoT;
  const ct = Math.cos(m.th), st = Math.sin(m.th);
  const compressao = (D, dx, g, R) => D - (m.z + dx * st - g - R) / Math.max(0.3, ct);
  const cF = compressao(DF, a, gF, p.raioF), cT = compressao(DT, -b, gT, p.raioT);
  const mola = (c, cAnt, k, cd, curso) => {
    if (c <= 0) return { f: 0, c: 0, dc: 0 };
    const dc = (c - cAnt) / dt;
    let f = k * c + cd * dc;
    if (c > curso) f += k * 25 * Math.min(c - curso, 0.15) + cd * 2 * Math.max(0, dc);   // batente no fim do curso
    return { f: Math.max(0, f), c, dc };
  };
  const sF = mola(cF, m.zF, kF, cdF, p.cursoF), sT = mola(cT, m.zT, kT, cdT, p.cursoT);
  const noArAntes = !m.noChao;
  if (m.queda > 0) {
    // caída: a vertical fica parada no chão (não simulamos o tombo); a moto só arrasta
    m.th += (0 - m.th) * Math.min(1, 6 * dt); m.wth = 0; m.vz = 0;
    m.z = p.cgAltura * 0.6 + (gF + gT) / 2;
    m.forcaF = p.massa * G * b / L; m.forcaT = p.massa * G * a / L;
    m.zF = p.sagF * p.cursoF; m.zT = p.sagT * p.cursoT; m.vzF = m.vzT = 0;
    m.noChao = m.frenteNoChao = m.traseiraNoChao = true; m.tempoNoAr = 0;
    return;
  }
  m.frenteNoChao = cF > 0; m.traseiraNoChao = cT > 0; m.noChao = m.frenteNoChao || m.traseiraNoChao;
  m.forcaF = sF.f; m.forcaT = sT.f;
  m.zF = clamp(sF.c, 0, p.cursoF * 1.05); m.zT = clamp(sT.c, 0, p.cursoT * 1.05);
  m.vzF = sF.dc; m.vzT = sT.dc;
  // carga da suspensão (MTX): alavanca para baixo no chão enche; golpe para cima solta
  if (corpo < -0.5) { m.tempoDesdeBaixo = 0; if (m.noChao) m.preload = Math.min(1, m.preload + dt / 0.6); }
  else m.tempoDesdeBaixo += dt;
  let impulso = 0;
  if (corpo > 0.5 && m.tempoDesdeBaixo < 0.3 && m.preload > 0.05) {
    if (m.noChao) { impulso = p.preloadImpulso * m.preload; m.wth += 0.35 * m.preload; }
    m.preload = 0;
  } else if (corpo > -0.5) m.preload = Math.max(0, m.preload - 1.5 * dt);
  const fPre = corpo < -0.5 && m.noChao ? -p.preloadForca * p.massa * G * m.preload : 0;
  // centro de massa anda com a postura automática e com a alavanca
  const dx = p.deslocaPostura * m.pesoLong + p.deslocaCorpo * corpo;
  // vertical e arfagem
  const az = (sF.f + sT.f) * ct / p.massa - G + fPre / p.massa;
  let torque = (sF.f * (a - dx) - sT.f * (b + dx)) * ct;
  const hEf = Math.max(0.3, m.z - (gF + gT) / 2);
  torque += fxContato * hEf;                                   // tração levanta a frente, freio afunda
  if (m.noChao) torque += -p.corpoTorqueChao * corpo;
  // wheelie (frente no ar, traseira no chão): a postura automática procura um ângulo de equilíbrio.
  // Alavanca para baixo segura o alvo; soltar traz a frente de volta; gás sobe, freio traseiro desce.
  if (m.traseiraNoChao && !m.frenteNoChao && m.th > 0.05) {
    const alvo = corpo < -0.3 ? p.wheelieAlvo : 0;
    torque += -p.wheelieRigidez * Math.max(0, m.th - alvo) - p.wheelieAmort * m.wth;
  }
  else {
    // no ar: gás levanta o nariz e freio traseiro abaixa (reação da roda); a alavanca soma;
    // e a postura automática alinha a moto com a inclinação do chão onde ela vai pousar
    const cr = Math.cos(m.rumo), sr = Math.sin(m.rumo), adiante = Math.max(0, m.u) * 0.35;
    const xa = m.x + cr * adiante, ya = m.y + sr * adiante;
    const alvoAr = Math.atan2(m.alturaChao(xa + cr * a, ya + sr * a) - m.alturaChao(xa - cr * b, ya - sr * b), L);
    torque += -p.corpoTorqueAr * corpo + (m.traseiraNoChao ? 0 : p.inerciaRodaT * dwTdt)
      + p.arRigidez * (alvoAr - m.th) - p.arAmort * m.wth;
  }
  m.vz += az * dt + impulso;
  m.z += m.vz * dt;
  m.wth += torque / p.inerciaArfagem * dt;
  if (!m.noChao) m.wth *= Math.exp(-0.3 * dt);
  m.th += m.wth * dt;
  if (m.th > 1.4) { m.th = 1.4; m.wth = Math.min(0, m.wth); }
  if (m.th < -1.2) { m.th = -1.2; m.wth = Math.max(0, m.wth); }
  m.vz = clamp(m.vz, -25, 25); m.wth = clamp(m.wth, -8, 8);
  // pouso e queda
  const rampaAng = Math.atan2(gF - gT, L);
  if (!m.noChao) m.tempoNoAr += dt;
  if (m.noChao && noArAntes && m.tempoNoAr > 0.25 && m.queda <= 0) {
    const rel = m.th - rampaAng;
    if (rel > 0.8 || rel < -0.6 || m.vz < -10) cai(m);
    m.tempoNoAr = 0;
  } else if (m.noChao) m.tempoNoAr = 0;
  if (m.noChao && m.th - rampaAng > 1.15 && m.queda <= 0) cai(m);       // wheelie passou do ponto: virou
}

function cai(m) { m.queda = 2.0; m.quedas++; m.preload = 0; }

// volta a moto ao chão, parada, num ponto e rumo dados (depois de uma queda)
export function reposiciona(m, x, y, rumo) {
  const p = m.p;
  Object.assign(m, { x, y, rumo, u: 0, v: 0, r: 0, wF: 0, wT: 0, th: 0, wth: 0, vz: 0, preload: 0, queda: 0, caiu: false,
    esterçoJogador: 0, contraguidao: 0, esterço: 0, zF: p.sagF * p.cursoF, zT: p.sagT * p.cursoT, vzF: 0, vzT: 0,
    noChao: true, frenteNoChao: true, traseiraNoChao: true, tempoNoAr: 0, tempoDesdeBaixo: 99,
    ax: 0, ay: 0, gas: 0, freioF: 0, freioT: 0, inclinacao: 0,
    velPatinagemT: 0, velLateralT: 0, patinagem: 0, deriva: 0, usoF: 0, usoT: 0,
    pesoLong: 0, pesoLat: 0, emPe: 0, peFora: 0 });
  m.z = p.cgAltura + m.alturaChao(x, y);
  m.forcaF = p.massa * G * m.b / p.entreEixos; m.forcaT = p.massa * G * m.a / p.entreEixos;
}

// postura do piloto como sinal para a animação (S2, S5, S6, S7, S19, S21)
function atualizaPiloto(m, dir, dt) {
  const vel = Math.abs(m.u), freio = Math.max(m.freioF, m.freioT);
  // peso: para trás freando ("bumbum para trás", S5), à frente acelerando (cabeça à frente, S2)
  const alvoLong = clamp(0.7 * m.gas * (1 - freio) - 0.9 * freio, -1, 1);
  m.pesoLong = suave(m.pesoLong, alvoLong, dt, 0.25);
  // em pé freando na reta em velocidade; sentado curvando (senta a ~1/4 da curva, S6)
  let alvoPe = m.emPe;
  if (freio > 0.3 && Math.abs(dir) < 0.3 && vel > 6) alvoPe = 1;
  else if (vel > 13 && Math.abs(dir) < 0.2) alvoPe = 0.8;
  else if (Math.abs(dir) > 0.35 || vel < 3) alvoPe = 0;
  m.emPe = suave(m.emPe, alvoPe, dt, 0.3);
  // pé de dentro para fora em curva lenta e sentado. Curva à direita: o pé direito
  // só sai depois de largar o freio traseiro (S7). A esquerda não depende do freio.
  let alvoPeFora = 0;
  if (m.emPe < 0.4 && vel > 1.5 && vel < 12 && Math.abs(dir) > 0.5) {
    if (dir > 0 && m.freioT < 0.1) alvoPeFora = 1;       // direita
    if (dir < 0) alvoPeFora = -1;                          // esquerda
  }
  m.peFora = suave(m.peFora, alvoPeFora, dt, 0.18);
  // corpo em relação à moto: acompanha a inclinação, mais em pé nas curvas lentas
  const k = vel > 10 ? 0.9 : 0.5;
  m.pesoLat = suave(m.pesoLat, clamp(m.inclinacao / 0.8, -1, 1) * k, dt, 0.2);
}

// sinais para o estudo de animação (Codex): nomes e faixas estáveis
export function sinais(m) {
  const p = m.p;
  return {
    velocidade: m.u,                                  // m/s
    giroF: m.wF, giroT: m.wT,                         // rad/s de cada roda (a traseira patina)
    gas: m.gas, freioF: m.freioF, freioT: m.freioT,
    guidao: m.esterço,                                // rad, com o contraguidão (+ = esquerda)
    guidaoJogador: m.esterçoJogador,
    contraguidao: m.contraguidao,                     // rad, parte automática
    deriva: m.deriva,                                 // rad, ângulo entre rumo e velocidade
    patinagem: m.patinagem,                           // 0..1
    aderenciaT: m.usoT, aderenciaF: m.usoF,           // uso da aderência 0..1
    inclinacao: m.inclinacao,                         // rad (+ = deitada para a esquerda)
    compressaoF: m.zF / p.cursoF, compressaoT: m.zT / p.cursoT,   // 0..1
    velSuspF: m.vzF, velSuspT: m.vzT,                 // m/s (+ comprime, - retorna)
    pesoLong: m.pesoLong,                             // -1 atrás .. +1 à frente
    pesoLat: m.pesoLat,                               // -1..1
    emPe: m.emPe,                                     // 0 sentado .. 1 em pé
    peFora: m.peFora,                                 // -1 esquerdo .. +1 direito
    noChao: m.noChao,                                 // alguma roda no chão
    traseiraNoChao: m.traseiraNoChao, frenteNoChao: m.frenteNoChao,
    arfagem: m.th,                                    // rad (+ nariz para cima)
    altura: m.z,                                      // m do centro de massa
    preload: m.preload,                               // 0..1 carga da suspensão (alavanca para baixo)
    queda: m.queda > 0,
  };
}

// integra com passos fixos pequenos (pneu é rígido)
export function avanca(m, entrada, sup, dt, sub = 1 / 600) {
  let resto = dt;
  while (resto > 1e-9) { const h = Math.min(sub, resto); passo(m, entrada, sup, h); resto -= h; }
  return m;
}

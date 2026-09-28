# Física de pilotagem no jogo

`fisica.js` é uma **cópia** de `prototipo-pilotagem/fisica.js`, o laboratório do Claude do Mac. Não edite aqui: mude no laboratório e rode `bash ferramentas/sincronizar-fisica.sh`, que também passa os testes.

O jogo usa essa física para o piloto do jogador. A ligação fica no `prototipo/index.html`, na seção "física do laboratório":
- o laboratório trabalha em metros, e o jogo converte com `K = 3,5` unidades por metro;
- o eixo y e o rumo trocam de sinal entre os dois;
- a altura do chão vem do relevo da pista do jogo;
- o piso vem da distância ao eixo da pista: barro batido, terra solta ou capim.

`?fisica=antiga` na URL volta para a física simples de antes.

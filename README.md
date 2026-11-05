# Climbing Over It — Web Co-op (REA Decompiled Physics)

Um clone Web cooperativo (P2P WebRTC) das mecânicas exatas de física de *Getting Over It with Bennett Foddy*, construído a partir da engenharia reversa do `Assembly-CSharp.dll` original usando **REA (`morluto/rea` - Reverse Engineer Anything)**, **Planck.js (Box2D)**, **TypeScript** e **PeerJS**.

---

## 🔬 Física Extraída com REA (`morluto/rea`)

A inspeção estática das instruções CIL de `Assembly-CSharp.dll` com `rea inspect-managed-members` revelou as equações e constantes exatas do jogo original:

1. **Gravidade Pesada (`GravityControl.Start` — token `0x0600017a`):**
   - `Physics2D.gravity = new Vector2(0f, -30f)` (3x mais forte que a gravidade padrão de `-9.81`).
2. **Filtro de Velocidade do Cursor Fantasma (`PlayerControl.FixedUpdate` — token `0x060001e0`):**
   - `mouseInput = Vector2.Lerp(oldMouse, curvedInput * mouseSensitivity, 0.5f)`
   - `mouseVelocityAverage = Mathf.Lerp(mouseVelocityAverage, Mathf.Max(0.1f * mouseInput.magnitude, 0.001f), 0.05f) + 0.005f`
   - Raio máximo do cursor limitado a `3.5m` do caldeirão e puxão elástico de volta à ponta da marreta quando ela trava em uma rocha.
3. **Motores das Juntas (`HingeJoint2D` + `SliderJoint2D`):**
   - Rotação do ombro (`hj`): ganho quadrático `Sign(delta) * Max(|delta/2|, delta²) * 3f`, limitado a `[-800, 800]` graus/s.
   - Extensão do braço (`sj`): velocidade amortecida pelo torque de reação `16f - Max(|reactionTorque| * 0.001f, 5f)` e alinhamento direcional `Pow(dot, 4)`, limitada a `[-50, 50]` m/s.
4. **Troca Dinâmica de Atrito (`HammerCollisions` & `PotSounds`):**
   - Enquanto a ponta do martelo se move menos que `moveThreshold = 0.03m` sobre uma superfície, o material alterna automaticamente de `slidingFriction` para `staticFriction`, permitindo travar e alavancar o corpo inteiro sem escorregar.
5. **Câmera Amortecida (`CameraControl.FixedUpdate` — token `0x06000156`):**
   - `vel += (60f * (target - pos) * dt) - 0.12f * vel`.

---

## 🤝 Como Jogar Co-op com Amigos

1. **Localmente ou Hospedado:**
   - Para rodar localmente:
     ```bash
     npm install
     npm run dev
     ```
   - Ou acesse o link público do GitHub Pages / Vercel.
2. **Criando uma Sala (Host):**
   - No painel superior direito, escolha seu **Nome** e **Cor**, e clique em **Criar Sala Co-op**.
   - Um código curto (ex: `GOI-A1B2`) será gerado. Clique em **Copiar Link** e mande para seus amigos.
3. **Entrando na Sala (Amigos):**
   - Basta abrir o link enviado (ele conecta sozinho!) ou digitar o código `GOI-XXXX` e clicar em **Entrar**.
   - **Sem Port Forwarding:** A conexão usa WebRTC DataChannels (UDP rápido) com servidores STUN do Google e da Cloudflare, atravessando roteadores domésticos automaticamente a custo **R$ 0,00**.
4. **Recursos Cooperativos:**
   - **Colisão Física entre Jogadores:** Você pode apoiar sua marreta no caldeirão do seu amigo para impulsioná-lo ou subir nele!
   - **Corda Cooperativa (Elástica):** Marque a opção *"Corda Cooperativa"* para amarrar uma corda elástica de `4.2m` entre os caldeirões (se um cair, o outro pode segurar!).
   - **Ir até Amigo:** Botão rápido de teleporte para testes e validação conjunta.

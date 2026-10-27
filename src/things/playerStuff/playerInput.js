// playerInput.js — per-frame input driver extracted from Player.
// Behavior-preserving move (2026-09-27): every `this` was the player.
// handleInput is called from preUpdate; setState is called by the
// state definitions and decideState. Wrappers on Player keep the
// original interface so nothing else changes.

import { getChatting } from "../../domStuff/Chat.js";

export function playerWalkLerp(player, delta, a, modify) {
    if (!modify) modify = player.body.blocked.down ? .5 : .1;

    modify = Phaser.Math.Clamp(modify * (delta / 16.666), 0, 1);
    return Phaser.Math.Linear(player.body.velocity.x, a, modify);
}

export function playerSetState(player, newState, input) {
    if (!player.scene) return;
    if (player.scene.time.now < player.stateLockout) return;
    if (newState === player.currentState) return;

    if (newState === 'idle' && !player.body.blocked.down) {
        newState = 'fall';
    }
    player.states[player.currentState].exit();
    player.currentState = newState;
    player.states[player.currentState].enter(input);
}

export function playerGetInput(player) {
    return {
        left: player.controls.left.isDown || document.leftButton.isClicked,
        right: player.controls.right.isDown || document.rightButton.isClicked,
        jump: player.controls.jump.isDown || document.jumpButton.isClicked,
        dash: player.controls.dash.isDown || document.dashButton.isClicked,
        crouch: player.controls.down.isDown || document.crouchButton.isClicked,
        heal: player.controls.up.isDown || document.healButton.isClicked,
        slam: Phaser.Input.Keyboard.JustDown(player.controls.down),
    };
}

export function playerDecideState(player, input, delta) {
    const { left, right, jump, dash, crouch, heal, slam } = input;

    if (dash && player.canDash && !player.isDashing) return player.setState('dash', input);
    if ((slam && !player.slamCD && !player.body.blocked.down)) return player.setState('slam', input);
    if (jump && player.canJump) return player.setState('jump', input);
    if (heal) return player.setState('heal');
    if ((crouch)) return player.setState('crouch', input);
    if (player.wallRunning) return player.setState('wallRun', input);
    if (player.wallSlide) return player.setState('wallSlide', input);
    if (!player.body.blocked.down) return player.setState('fall', input);
    if (left || right) return player.setState('walk', input);
    player.meditateTimer += delta / 1000;
    if (player.meditateTimer > 3) return player.setState('meditate');
    return player.setState('idle', input);
}

export function playerHandleInput(player, time, delta) {
    if (!player.body || !player.body.velocity) return;
    if (player.chatting) {
        player.setState('idle');
        player.states[player.currentState].update(delta, {}, time);
    }

    if (!player.stunned && player.alive && !player.chatting) {

        let input = player.getInput();

        if (getChatting()) {
            input = {};
        }
        if ((input.left || input.right) && player.spectating) {
            player.spectatePlayer(false);
        }
        if (input.left && !input.right) {
            player.flipX = true;
            player.dir = -1;
        } else if (input.right && !input.left) {
            player.flipX = false;
            player.dir = 1;
        }

        player.decideState(input, delta);       // decide what state to be in based on input
        player.states[player.currentState].update(delta, input, time); // update current state logic
        if ((player.slamCD || player.slidePower < 600) && !player.isSliding && !player.isCrouch) {
            player.slidePower = Math.min(600, player.slidePower += delta);
            player.slamCD = Math.max(0, player.slamCD -= delta);
        }
    }

    player.animChooser(delta);
}

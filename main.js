// npx --yes live-server --host=0.0.0.0 --port=8080
// http://10.0.0.145:8080

const FPS = 30
const MS_PER_FRAME = 1000 / FPS
function getShim() { return (canvas?.width || window.innerWidth) / 10 }
function getBallRadius() { return (canvas?.width || window.innerWidth) / 20 }
function getTeammateRadius() { return (canvas?.width || window.innerWidth) / 20 }
const FRICTION = .99
const FLING_DIVISOR = 2

let canvas;
let ctx;
let ball = {
	xPos: 0,
	yPos: 0,
	xVel: 0,
	yVel: 0,
	isBeingFlung: false
}
let team = []
let teamRemaining = []
let wall = []
let walls = []
let touch1 = {
	xPos: 0,
	yPos: 0
}
let tries = 0
let levelScore = 0
let totalScore = 0
let gameLoopTimeout = null

function initializeGame() {
	canvas = document.getElementById("canvas")
	resizeCanvas()
	ctx = canvas.getContext('2d')
	window.addEventListener("resize", resizeCanvas)
	if (visualViewport) {
		visualViewport.addEventListener("resize", resizeCanvas)
	}
	document.addEventListener("touchstart", handleTouchstart)
	document.addEventListener("touchmove", handleTouchmove, { passive: false })
	document.addEventListener("touchend", handleTouchend)
	document.getElementById("retryButton").addEventListener("click", () => generateLevel(true))
	document.getElementById("nextButton").addEventListener("click", () => generateLevel())
	document.addEventListener("wheel", (e) => e.preventDefault(), { passive: false })
	generateLevel()
}

function generateLevel(isRetry = false) {
	placeBall()
	if (!isRetry) {
		totalScore += levelScore
		placeTeam()
	}
	teamRemaining = JSON.parse(JSON.stringify(team))
	walls = []
	levelScore = 0
	tries = 0
	if (gameLoopTimeout !== null) {
		clearTimeout(gameLoopTimeout)
		gameLoopTimeout = null
	}
	loopGame()
}

function loopGame() { // MAIN GAME LOOP
	moveBall()
	handleCollision()
	draw()
	gameLoopTimeout = setTimeout(loopGame, MS_PER_FRAME)
}

function handleTouchstart(e) {
	touch1 = {
		xPos: e.touches[0].clientX,
		yPos: e.touches[0].clientY
	}
	if (isObjectCloseToObject(touch1, getShim() * 2, ball)) {
		ball.isBeingFlung = true
		tries++
	} else {
		wall = []
		wall.push({
			xPos: touch1.xPos, 
			yPos: touch1.yPos 
		})
	}
}

function handleTouchmove(e) {
	e.preventDefault()
	let touch2 = { 
		xPos: e.touches[0].clientX, 
		yPos: e.touches[0].clientY 
	}
	if (ball.isBeingFlung) {
		ball.xVel = (touch2.xPos - touch1.xPos) / FLING_DIVISOR
		ball.yVel = (touch2.yPos - touch1.yPos) / FLING_DIVISOR
	} else {
		wall.push(touch2)
	}
}

function handleTouchend() {
	if (ball.isBeingFlung === false) {
		walls.push(wall)
	}
	ball.isBeingFlung = false
}

function placeBall() {
	ball = {
		xPos: getRandomX(),
		yPos: canvas.height - getShim(),
		xVel: 0,
		yVel: 0,
		isBeingFlung: false
	}
}

function placeTeam() {
	team = []
	for (let i = 0; i < 5; i++) {
		team.push({ 
			xPos: getRandomX(), 
			yPos: getRandomY() 
		})
	}
}

function moveBall() {
	ball.xPos += ball.xVel
	ball.yPos += ball.yVel
	ball.xVel *= FRICTION 
	ball.yVel *= FRICTION
}

function handleCollision() {
	handleCollisionWithTeammate()
	handleCollisionWithWall()
	handleCollisionWithEdge()
}

function handleCollisionWithTeammate() {
	for (let i = 0; i < teamRemaining.length; i++) {
		let teammate = teamRemaining[i]
		if (isObjectCloseToObject(ball, getShim(), teammate)) {
			let rewardPoints = Math.round(100 / Math.max(tries, 1))
			teamRemaining.splice(i, 1)
			levelScore = levelScore + rewardPoints
		}
	}
}

function handleCollisionWithWall() {
	walls.forEach(path => {
		for (let i = 1; i < path.length - 1; i++) {
			let point = path[i]
			if (isObjectCloseToObject(ball, getShim(), point)) {
				let wallVectorX = path[i++].xPos - path[i--].xPos
				let wallVectorY = path[i++].yPos - path[i--].yPos
				let normalVectorX = -wallVectorY
				let normalVectorY = wallVectorX
				let length = Math.hypot(normalVectorX, normalVectorY)
				normalVectorX /= length
				normalVectorY /= length
				let dot = ball.xVel * normalVectorX + ball.yVel * normalVectorY
				ball.xVel = ball.xVel - 2 * dot * normalVectorX
				ball.yVel = ball.yVel - 2 * dot * normalVectorY
			}
		}
	})
}

function handleCollisionWithEdge() {
	if (ball.yPos <=0 || ball.yPos >= canvas.height) {
    ball.yVel = -ball.yVel
  }
  if (ball.xPos <= 0 || ball.xPos >= canvas.width) {
    ball.xVel = -ball.xVel
	}
}

function draw() {
	ctx.clearRect(0, 0, canvas.width, canvas.height)
	drawBall()
	drawTeam()
	drawWalls()
	drawScore()
}

function drawBall() {
	ctx.beginPath()
	ctx.arc(ball.xPos, ball.yPos, getBallRadius(), 0, 2 * Math.PI)
	ctx.fillStyle = "grey"
	ctx.fill()
}

function drawTeam() {
	for (let i=0; i<teamRemaining.length; i++) {
		let teammate = teamRemaining[i]
		ctx.beginPath()
		ctx.arc(teammate.xPos, teammate.yPos, getTeammateRadius(), 0, 2 * Math.PI)
		ctx.fillStyle = "blue"
		ctx.fill()	
	}
}

function drawWalls() {
	ctx.lineWidth = 20
	ctx.strokeStyle = "purple"
	walls.forEach(wallPath => {
		if (wallPath.length < 2) {
			return
		}
		ctx.beginPath()
		ctx.moveTo(wallPath[0].xPos, wallPath[0].yPos)
		wallPath.forEach(wallPoint => {
			ctx.lineTo(wallPoint.xPos, wallPoint.yPos)
		})
		ctx.stroke()
	})
	// Draw the current wall being drawn
	if (wall.length >= 2 && !ball.isBeingFlung) {
		ctx.beginPath()
		ctx.moveTo(wall[0].xPos, wall[0].yPos)
		wall.forEach(wallPoint => {
			ctx.lineTo(wallPoint.xPos, wallPoint.yPos)
		})
		ctx.stroke()
	}
}

function drawScore() {
	ctx.font = "20px Arial"
	ctx.fillStyle = "yellow"
	let scoreText = levelScore > 0 ? `Score: ${totalScore} +${levelScore}` : `Score: ${totalScore}`
	ctx.fillText(scoreText, 10, 20)
}

function isObjectCloseToObject(objectA, distance, objectB) {
  return (
    Math.abs(objectA.xPos - objectB.xPos) < distance && 
    Math.abs(objectA.yPos - objectB.yPos) < distance
  )
}

function getRandomX() {
	return (canvas?.width || window.innerWidth) * Math.random()
}

function getRandomY() {
	return (canvas?.height || window.innerHeight) * Math.random()
}

function resizeCanvas() {
	if (canvas) {
		canvas.width = window.innerWidth
		canvas.height = window.innerHeight
	}
}
// npx --yes live-server --host=0.0.0.0 --port=8080
// http://10.0.0.145:8080

const MILLISECONDS_PER_FRAME = 100/3 // 30 FPS
const BALL_RADIUS = visualViewport.width / 20
const ATHLETE_RADIUS = visualViewport.width / 20
const POST_THICKNESS = 3
const FRICTION = .99
const SHIM = visualViewport.width / 10
const FLING_DIVISOR = 2
const MINIMUM_SPEED = 10
const WALL_WIDTH = 50
const BALL = {
	xPos: visualViewport.width * Math.random(),
	yPos: visualViewport.height * Math.random(),
	xVel: 0,
	yVel: 0,
	color: "grey"
}
const GOALS = {
	width: 50,
	height: 50,
	blue: {
		xPos: visualViewport.width * Math.random(),
		yPos: visualViewport.height * Math.random(),
		angle: Math.random() * 2 * Math.PI,
		color: "blue"
	},
	red: {
		xPos: visualViewport.width * Math.random(),
		yPos: visualViewport.height * Math.random(),
		angle: Math.random() * 2 * Math.PI,
		color: "red"
	}
}

let canvas;
let context;
let ball = BALL
let touch1 = {
	xPos: 0,
	yPos: 0
}
let goals = GOALS
let blueTeam = {
	color: "blue",
	roster: []
}
let redTeam = {
	color: "red",
	roster: []
}
let walls = []
let isUserFlingingBall = false

function initializeGame() {
	canvas = document.getElementById("canvas")
	canvas.width = visualViewport.width
	canvas.height = visualViewport.height
	context = canvas.getContext('2d')
	document.addEventListener("touchstart", handleTouchstart)
	document.addEventListener("touchmove", handleTouchmove, { passive: false })
	startGame()
}

function startGame() {
	generateRedTeam()
	generateWalls()
	loopGame()
}

function loopGame() {
	moveBall()
	handleCollisions()
	draw()
	setTimeout(loopGame, MILLISECONDS_PER_FRAME)
}

function handleTouchstart(e) {
	touch1.xPos = e.touches[0].clientX
	touch1.yPos = e.touches[0].clientY
	if (isObjectCloseToObject(touch1, SHIM, ball)) {
		isUserFlingingBall = true
	} else {
		blueTeam.roster.push(
			{
				xPos: touch1.xPos,
				yPos: touch1.yPos
			}
		)
	}
}

function handleTouchmove(e) {
	e.preventDefault()
	let touch2 = {
		xPos: e.touches[0].clientX,
		yPos: e.touches[0].clientY
	}
	if (isUserFlingingBall == true) {
		ball.xVel = (touch2.xPos - touch1.xPos) / FLING_DIVISOR
		ball.yVel = (touch2.yPos - touch1.yPos) / FLING_DIVISOR
	}
}

function moveBall() {
	ball.xPos += ball.xVel
	ball.yPos += ball.yVel
	ball.xVel *= FRICTION
	ball.yVel *= FRICTION
	if (Math.abs(ball.yVel) < MINIMUM_SPEED && Math.abs(ball.xVel) < MINIMUM_SPEED) {
		ball.xVel = 0
		ball.yVel = 0
	}
}

function generateWalls() {
	for (let i=0; i<4; i++) {
		let angle = Math.random() * 2 * Math.PI
		let xPosOfPointA = canvas.width * Math.random()
		let yPosOfPointA = canvas.height * Math.random()
		walls.push(
			{
				xPosOfPointA: xPosOfPointA,
				yPosOfPointA: yPosOfPointA,
				xPosOfPointB: xPosOfPointA + WALL_WIDTH * Math.cos(angle),
				yPosOfPointB: yPosOfPointA + WALL_WIDTH * Math.sin(angle)
			}
		)
	}
}

function handleCollisions() {
	if (ball.yPos <=0 || ball.yPos >= canvas.height) {
		ball.yVel = -ball.yVel
	}
	if (ball.xPos <= 0 || ball.xPos >= canvas.width) {
		ball.xVel = -ball.xVel
	}
}

function generateRedTeam() {
	for (let i=0; i<5; i++) {
		redTeam.roster.push(
			{
				xPos: visualViewport.width * Math.random(),
				yPos: visualViewport.height * Math.random()
			}
		)
	}
}

function draw() {
	context.clearRect(0, 0, canvas.width, canvas.height)
	drawBall()
	drawBlueGoal()
	drawRedGoal()
	drawTeam(blueTeam)
	drawTeam(redTeam)
	drawWalls()
}

function drawWalls() {
	for (let i=0; i<walls.length; i++) {
		let wall = walls[i]
		context.lineWidth = 3
		context.strokeStyle = "grey"
		context.beginPath()
		context.moveTo(wall.xPosOfPointA, wall.yPosOfPointA)
		context.lineTo(wall.xPosOfPointB, wall.yPosOfPointB)
		context.stroke()
	}
}

function drawBall() {
	context.beginPath()
	context.arc(ball.xPos, ball.yPos, BALL_RADIUS, 0, 2 * Math.PI)
	context.fillStyle = ball.color
	context.fill()
}

function drawBlueGoal() {
	context.save()
	context.translate(goals.blue.xPos, goals.blue.yPos)
	context.rotate(goals.blue.angle)
	context.fillStyle = goals.blue.color
	context.fillRect(-POST_THICKNESS, 0, POST_THICKNESS, goals.height)
	context.fillRect(goals.width, 0, POST_THICKNESS, goals.height)
	context.fillRect(-POST_THICKNESS, goals.height, goals.width + POST_THICKNESS * 2, POST_THICKNESS)
	context.restore()
}

function drawRedGoal() {
	context.save()
	context.translate(goals.red.xPos, goals.red.yPos)
	context.rotate(goals.red.angle)
	context.fillStyle = goals.red.color
	context.fillRect(-POST_THICKNESS, 0, POST_THICKNESS, goals.height)
	context.fillRect(goals.width, 0, POST_THICKNESS, goals.height)
	context.fillRect(-POST_THICKNESS, goals.height, goals.width + POST_THICKNESS * 2, POST_THICKNESS)	
	context.restore()
}

function drawTeam(team) {
	for (let i=0; i<team.roster.length; i++) {
		let member = team.roster[i]
		context.beginPath()
		context.arc(member.xPos, member.yPos, ATHLETE_RADIUS, 0, 2 * Math.PI)
		context.fillStyle = team.color,
		context.fill()
	}
}

function isObjectCloseToObject(objectA, distance, objectB) {
  return (
    Math.abs(objectA.xPos - objectB.xPos) < distance && 
    Math.abs(objectA.yPos - objectB.yPos) < distance
  )
}
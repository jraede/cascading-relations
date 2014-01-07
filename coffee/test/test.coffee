mongoose = require 'mongoose'
relations = require '../index'
should = require 'should'
mongoose.connect 'mongodb://localhost/mongoose_relations_test'
mongoose.set 'debug', true

barSchema = new mongoose.Schema
	_foo:
		type:mongoose.Schema.Types.ObjectId
		ref:'Foo'
		$through:'_bar'
	_baz:
		type:mongoose.Schema.Types.ObjectId
		ref:'Baz'
		$through:'_bar'
		$cascadeDelete:true

	title:String
	account:String

fooSchema = new mongoose.Schema
	title:String
	_bars:[
			type:mongoose.Schema.Types.ObjectId
			ref:'Bar'
			$through:'_foo'
	]
	_bar:
		type:mongoose.Schema.Types.ObjectId
		ref:'Bar'
		$through:'_foo'

	multi:
		_bar:
			type:mongoose.Schema.Types.ObjectId
			$cascadeDelete:true
			ref:'Bar'
		_bars:[
				type:mongoose.Schema.Types.ObjectId
				ref:'Bar'
		]

bazSchema = new mongoose.Schema
	title:String
	_bar:
		type:mongoose.Schema.Types.ObjectId
		ref:'Bar'
		$through:'_baz'

fooSchema.plugin(relations)
barSchema.plugin(relations)
bazSchema.plugin(relations)

barClass = mongoose.model('Bar', barSchema)
fooClass = mongoose.model('Foo', fooSchema)
bazClass = mongoose.model('Baz', bazSchema)

describe 'Testing', ->
	@timeout(10000)
	it 'should populate on $related and leave IDs intact', (done) ->
		bar = new barClass
			title:'My Bar'

		bar.save (err, res) ->
			foo = new fooClass
				title:'My Foo'
				multi:
					_bars:[res._id]

			foo.cascadeSave (err, res) ->

				mongoose.model('Foo').find().populate('multi._bars').exec (err, res) ->

					res[0].multi._bars[0].toString().should.equal(bar._id.toString())
					res[0]._related.multi._bars[0].title.should.equal('My Bar')
					done()
	it 'should cascade save relations', (done) ->
		foo = new fooClass
			title:'My Foo'
			_related:
				multi:
					_bars:[
							title:'First Bar'
						,

							title:'Second Bar'
					]
					_bar:
						title:'Third Bar'
				_bar:
					title:'Fourth Bar'
				_bars:[
						title:'Fifth Bar'
					,
						title:'Sixth Bar'
				]
		foo.cascadeSave (err, res) =>
			@foo = foo
			res._related._bars[0].title.should.equal('Fifth Bar')
			res._related._bar.title.should.equal('Fourth Bar')
			res._related.multi._bars[1].title.should.equal('Second Bar')
			res._related.multi._bar.title.should.equal('Third Bar')
			res._related._bar._foo.toString().should.equal(res._id.toString())
			done()
	it 'should have set the $through value on a relation array', (done) ->
		@foo._related._bars[0]._foo.toString().should.equal(@foo._id.toString())
		done()
	it 'should cascade delete when designated', (done) ->
		deletedBarId = @foo.multi._bar
		throughBarId = @foo._bar
		@foo.remove (err, res) ->
			# Now wait for the post remove middleware to finish
			setTimeout ->
				barClass.findById deletedBarId, (err, res)  ->
					should.not.exist(res)
					barClass.findById throughBarId, (err, res) ->
						should.not.exist(res._foo)
						done()

			, 5000

	

	it 'should cascade save multiple levels deep', (done) ->
		foo = new fooClass
			title:'My Foo'
			_related:
				multi:
					_bar:
						title:'My Bar'
						_related:
							_baz:
								title:'My Baz'
		foo.cascadeSave (err, result) =>
			@foo = result
			result._related.multi._bar._related._baz.title.should.equal('My Baz')
			result._related.multi._bar._related._baz._bar.toString().should.equal(result._related.multi._bar._id.toString())
			done()
	it 'should cascade delete multiple levels deep', (done) ->
		deletedBazId = @foo._related.multi._bar._related._baz._id
		@foo.remove (err, res) ->
			setTimeout ->
				bazClass.findById deletedBazId, (err, res)  ->
					should.not.exist(res)
					done()

			, 5000
	it 'should do normal save without cascading', (done) ->
		foo = new fooClass
			title:'My Foo'
			_related:
				_bar:
					title:'My Bar'
		foo.save (err, result) ->
			should.not.exist(foo._bar)
			done()

	it 'should do a save while limiting cascaded relations', (done) ->
		foo = new fooClass
			title:'My Foo'
			_related:
				_bar:
					title:'My Bar'
					_related:
						_baz:
							title:'My Baz'
				multi:
					_bar:
						title:'My Bar 2'
						_related:
							_baz:
								title:'My Baz 2'
		foo.cascadeSave (err, res) =>
			@foo = res
			should.not.exist(res._related._bar._baz)
			done()
		, 
			limit:['_bar', 'multi._bar', 'multi._bar._baz']
			filter:(doc) ->
				doc.account = 'asdf'
				return doc


	it 'should apply filter to cascading relations when saving', (done) ->
		@foo._related._bar.account.should.equal('asdf')
		done()






mongoose = require 'mongoose'
dot = require 'dotaccess'
Q = require 'q'
_ = require 'underscore'
module.exports = (schema, options) ->
	# schema.add
	# 	'_related':mongoose.Schema.Types.Mixed
	schema.virtual('_related').get ->
		return @$__.related
	.set (val) ->
		@$__.related = val

	schema.set 'toObject', 
		virtuals:true

	schema.set 'toJSON',
		virtuals:true


	# Move populated docs over to _related and keep the original IDs
	schema.post 'init', (next) ->
		@$__movePopulated()
		
		
		return true

	schema.methods.$__movePopulated = (paths=null) ->
		
		if @$__.populated?
			if !@_related?
				@_related = {}

			# Normalize
			if paths
				if !(paths instanceof Array)
					paths = [paths]
			else 
				paths = _.keys(@$__.populated)
			for path in paths
				info = @$__.populated[path]
				if !info?
					continue
				val = info.value
				orig = dot.get(@, path)

				# Mongoose array push tries to cast, so we don't want that
				if orig instanceof Array
					orig.push = Array.prototype.push


				dot.set(@, path, val, true)
				dot.set(@_related, path, orig, true)


				# Mongoose stores previously populated values to account for its inability to really handle
				# cascading relations, so it ends up using previously populated value instead of new one.
				delete @$__.populated[path]



	schema.methods.populate = ->
		args = _.values(arguments)

		paths = args[0]

		callback = args.pop()
		args.push (err, doc) =>
			if !err

				@$__movePopulated(paths)
				callback(err, doc)
			else
				callback(err, doc)

		mongoose.Document.prototype.populate.apply(@, args)
			


	schema.methods.cascadeSave = (callback, config=null) ->
		@$__.cascadeSave = true

		@$__.cascadeSaveConfig = config
		return @save(callback)
	# Save relations and update refs
	schema.methods.$__saveRelation = (path, val) ->
		deferred = Q.defer()

		


		allowedRelation = (rel) =>
			for allowed in @$__.cascadeSaveConfig.limit
				if allowed.substr(0, rel.length) is rel
					return true
			return false
		# If they're not allowed to save that one, then skip it
		if @$__.cascadeSaveConfig and @$__.cascadeSaveConfig.limit and !allowedRelation(path)
			deferred.resolve()
			return deferred.promise
		
		promises = []
		if @schema.paths[path]
			if @schema.paths[path].instance is 'ObjectID' and @schema.paths[path].options.ref?
				promises.push(@$__saveSingleRelationAtPath(path))
			else if @schema.paths[path].options.type instanceof Array and @schema.paths[path].caster and @schema.paths[path].caster.instance is 'ObjectID' and @schema.paths[path].caster.options.ref?
				promises.push(@$__saveMultiRelationAtPath(path))

		else if typeof val is 'object'
			for key,newVal of val
				promises.push(@$__saveRelation(path + '.' + key, newVal))

		if !promises.length
			deferred.resolve()
		else
			Q.all(promises).then ->
				deferred.resolve()
			, (err) ->
				deferred.reject(err)
		return deferred.promise

	schema.methods.$__saveSingleRelationAtPath = (path) ->
		deferred = Q.defer()
		# Get the ref
		ref = @schema.paths[path].options.ref
		through = @schema.paths[path].options.$through

		data = dot.get(@get('_related'), path)

		@$__saveRelatedDoc(path, data, ref, through).then (res) =>
			@$__.populateRelations[path] = res
			@set(path, res._id)
			deferred.resolve()
		, (err) ->
			deferred.reject(err)

		return deferred.promise

	schema.methods.$__saveMultiRelationAtPath = (path) ->
		deferred = Q.defer()
		# Get the ref
		ref = @schema.paths[path].caster.options.ref
		through = @schema.paths[path].caster.options.$through


		data = dot.get(@get('_related'), path)

		promises = []

		# Data needs to be an array. If it's not we're fucked
		if !(data instanceof Array)
			deferred.reject(new Error("Data for multi relation must be an array!"))
		else
			for doc in data
				promises.push(@$__saveRelatedDoc(path, doc, ref, through))

			Q.all(promises).then (results) =>
				
				# Reorder according to the IDs
				@$__.populateRelations[path] = {}
				for result in results
					@$__.populateRelations[path][result._id.toString()] = result

				deferred.resolve()
			, (err) ->
				deferred.reject(err)

		return deferred.promise



	schema.methods.$__saveRelatedDoc = (path, data, ref, through) ->
		deferred = Q.defer()
		# If there's a through, set it, since we already have the ID
		if through
			d = dot.get(data, through)
			if d instanceof Array
				if d.indexOf(@_id) < 0
					d.push(@_id)
					dot.set(data, through, d, true)
			else
				dot.set(data, through, @_id, true)

		# If there is a filter defined in the cascade save config, apply them
		if @$__.cascadeSaveConfig and @$__.cascadeSaveConfig.filter

			filter = @$__.cascadeSaveConfig.filter
			data = filter.apply(@, [data, path])
		else
			filter = null

		modelClass = mongoose.model(ref)
		
		# If there's an ID, fetch the object and update it.
		# Should we use middleware here? Or just findByIdAndUpdate?
		orig = @get(path)
		if orig instanceof Array
			isArray = true
		else
			isArray = false

		# For some reason mongoose automatically makes it an object if you add to a populated path
		getPrototype = (object) ->
			funcNameRegex = /function (.{1,})\(/;
			results = (funcNameRegex).exec((object).constructor.toString())
			return if (results && results.length > 1) then results[1] else ""


		isNewModel = (getPrototype(data) is 'model' and data.isNew)

		if data._id and !isNewModel
			if isArray
				if orig.indexOf(data._id) < 0
					orig.push(data._id)
					@set(path, orig)
			else
				@set(path, data._id)
			modelClass.findById data._id, (err, res) =>
				if err
					return deferred.reject(err)
				else if !res
					return deferred.reject(new Error('Could not find ref ' + ref + ' with ID ' + data._id.toString()))
				delete data._id
				res.set(data)

				# If it has a cascade save method, use it. Otherwise just use save
				newArr = null
				if res.cascadeSave? and typeof res.cascadeSave is 'function'
					method = 'cascadeSave'

					# And we also need to pass along the relevant paths in limitRelations
					if @$__.cascadeSaveConfig and @$__.cascadeSaveConfig.limit?
						newArr = []
						for allowed in @$__.cascadeSaveConfig.limit
							if allowed.substr(0, path.length + 1) is (path + '.')
								newArr.push(allowed.substr(path.length + 1))

				else
					method = 'save'

				res[method] (err, res) =>
					if err
						return deferred.reject(err)

					deferred.resolve(res)
				, 
					limit:newArr
					filter:filter
		else
			# We need to create a new one
			newMod = new modelClass(data)
			if isArray

				# Mongoose overrides the push so it automatically turns into a document. We
				# don't want that.
				orig.push = Array.prototype.push
				orig.push(newMod._id)
				@set(path, orig)
			else
				@set(path, newMod._id)
			newArr = null
			if newMod.cascadeSave? and typeof newMod.cascadeSave is 'function'
				method = 'cascadeSave'
				if @$__.cascadeSaveConfig and @$__.cascadeSaveConfig.limit?
					newArr = []
					for allowed in @$__.cascadeSaveConfig.limit
						if allowed.substr(0, path.length + 1) is (path + '.')
							newArr.push(allowed.substr(path.length + 1))

			else
				method = 'save'

			newMod[method] (err, res) =>
				if err
					return deferred.reject(err)
				deferred.resolve(res)
			, 
				limit:newArr
				filter:filter

		# Set it to the updated value
		return deferred.promise
	schema.pre 'save', (next) ->
		if @$__.cascadeSave
			@$__.populateRelations = {}
			if @_related?
				promises = []
				for path,val of @_related
					promises.push(@$__saveRelation(path, val))
				Q.all(promises).then ->
					next()
				, (err) ->
					next(err)
			else
				next()
		else
			next()


	schema.pre 'save', (next) ->
		if @$__.cascadeSave
			# Update related with new related objects
			newRelated = {}
			for path,rels of @$__.populateRelations
				curVal = @get(path)
				if curVal instanceof Array
					newVal = []
					for id in curVal
						if rels[id.toString()]?
							newVal.push(rels[id.toString()])
						else
							newVal.push(id)
					dot.set(newRelated, path, newVal, true)
				else
					if rels._id is curVal
						dot.set(newRelated, path, rels, true)
					else
						dot.set(newRelated, path, curVal, true)
			@set('_related', newRelated)
			@$__.cascadeSave = false

		next()

	schema.methods.$__handleDeletion = (path) ->

		if @schema.paths[path].instance is 'ObjectID' and @schema.paths[path].options.ref?
			@$__handleDeletionAtSingleRelationPath(path)
		else if @schema.paths[path].options.type instanceof Array and @schema.paths[path].caster and @schema.paths[path].caster.instance is 'ObjectID' and @schema.paths[path].caster.options.ref?
			@$__handleDeletionAtMultiRelationPath(path)

	schema.methods.$__handleDeletionAtSingleRelationPath = (path) ->
		ref = @schema.paths[path].options.ref
		cascade = @schema.paths[path].options.$cascadeDelete
		through = @schema.paths[path].options.$through
		@$__handleDeletionOfDoc(ref, @get(path), cascade, through)

	schema.methods.$__handleDeletionAtMultiRelationPath = (path) ->
		ref = @schema.paths[path].caster.options.ref
		cascade = @schema.paths[path].caster.options.$cascadeDelete
		through = @schema.paths[path].caster.options.$through
		
		data = @get(path)
		for id in data
			@$__handleDeletionOfDoc(ref, id, cascade, through)

	schema.methods.$__handleDeletionOfDoc = (ref, id, cascade, through) ->
		modelClass = mongoose.model(ref)

		# If it's cascade, just delete that other one. It might cascade too. Who cares?
		if cascade
			modelClass.findById id, (err, res) ->
				if res
					res.remove()
		
		# Otherwise, we need to update its $through value to not reference this one anymore
		else if through
			modelClass.findById id, (err, res) ->
				if res
					res.set(through, null)
					res.save()




	schema.post 'remove', (doc) ->
		# Handle relations. Basically we need to remove a reference
		# to this document in any related documents, or do a cascade
		# delete if designated
		for path,config of @schema.paths
			@$__handleDeletion(path)
		

